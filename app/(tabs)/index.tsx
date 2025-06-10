import {
  selectIsConnectedToRoom,
  selectLocalPeer,
  selectPeers,
  useAVToggle,
  useHMSActions,
  useHMSStore,
  useVideo,
} from "@100mslive/react-sdk";
import { initializeApp } from "firebase/app";
import {
  addDoc,
  collection,
  doc,
  getFirestore,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";
import {
  getDownloadURL,
  getStorage,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import React, { useEffect, useRef, useState } from "react";
import "./styles.css";

// --- Mock Firebase and 100ms Data (for demonstration) ---
// In your actual app, you would have real config and SDK providers.
const firebaseConfig = {
  apiKey: "AIzaSyCmObxp7iTlgt6gYSfhC2dqVHEoB2a16BQ",
  authDomain: "findit-ai-d93c6.firebaseapp.com",
  databaseURL:
    "https://findit-ai-d93c6-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "findit-ai-d93c6",
  storageBucket: "findit-ai-d93c6.firebasestorage.app",
  messagingSenderId: "669473493302",
  appId: "1:669473493302:web:f23deceadadbef92b9a397",
  measurementId: "G-G9KQLTWJE2",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// --- Helper Functions for Snapshot ---

/**
 * Creates a canvas, draws the video frame to it, and returns a data URL.
 * @param {HTMLVideoElement} inputVideo The video element to capture.
 * @returns {string} A base64 encoded data URL of the captured image.
 */
export const createSnapshotFromVideo = (inputVideo) => {
  const canvas = document.createElement("canvas");
  canvas.width = inputVideo.videoWidth;
  canvas.height = inputVideo.videoHeight;
  const context = canvas.getContext("2d");
  if (context) {
    context.drawImage(inputVideo, 0, 0, canvas.width, canvas.height);
  }
  return canvas.toDataURL("image/png");
};

// --- React Components ---

function JoinForm() {
  const hmsActions = useHMSActions();
  const [inputValues, setInputValues] = useState({ name: "", token: "" });

  const handleInputChange = (e) => {
    setInputValues((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const authToken = await hmsActions.getAuthTokenByRoomCode({
        roomCode: inputValues.token,
      });
      await hmsActions.join({ userName: inputValues.name, authToken });
    } catch (error) {
      console.error("Error joining room:", error);
      // You could show an error message to the user here
    }
  };

  return (
    <div className="join-form-container">
      <form onSubmit={handleSubmit} className="join-form">
        <h2 className="form-title">Join Photo Session</h2>
        <div className="input-group">
          <input
            required
            value={inputValues.name}
            onChange={handleInputChange}
            id="name"
            type="text"
            name="name"
            placeholder="Your name"
            className="input-field"
          />
        </div>
        <div className="input-group">
          <input
            required
            id="token"
            type="text"
            name="token"
            placeholder="Room code"
            value={inputValues.token}
            onChange={handleInputChange}
            className="input-field"
          />
        </div>
        <button type="submit" className="btn btn-primary">
          Join
        </button>
      </form>
    </div>
  );
}

function Peer({ peer, videoRefs }) {
  const { videoRef } = useVideo({ trackId: peer.videoTrack });
  const isLocal = peer.isLocal;

  return (
    <div className={`peer-container ${isLocal ? "local-peer" : "remote-peer"}`}>
      <video
        ref={(el) => {
          // This callback connects the element to the useVideo hook's ref
          videoRef(el);
          // And this part updates our central map of video elements
          if (el) {
            videoRefs.current.set(peer.id, el);
          } else {
            videoRefs.current.delete(peer.id);
          }
        }}
        className="peer-video"
        autoPlay
        muted={isLocal} // Only mute local peer's video
        playsInline
      />
      <div className="peer-name">
        {peer.name} {isLocal ? "(You)" : ""}
      </div>
    </div>
  );
}

function Conference({ videoRefs }) {
  const peers = useHMSStore(selectPeers);
  return (
    <div className="conference-section">
      <div className={`peers-container peers-count-${peers.length}`}>
        {peers.map((peer) => (
          <Peer key={peer.id} peer={peer} videoRefs={videoRefs} />
        ))}
      </div>
    </div>
  );
}

function Footer() {
  const { isLocalAudioEnabled, isLocalVideoEnabled, toggleAudio, toggleVideo } =
    useAVToggle();
  const hmsActions = useHMSActions();

  return (
    <div className="control-bar">
      <button className="btn btn-control" onClick={toggleAudio}>
        {isLocalAudioEnabled ? "Mute" : "Unmute"}
      </button>
      <button className="btn btn-control" onClick={toggleVideo}>
        {isLocalVideoEnabled ? "Hide Video" : "Show Video"}
      </button>
      <button
        className="btn btn-control btn-leave"
        onClick={() => hmsActions.leave()}
      >
        Leave
      </button>
    </div>
  );
}

// --- Main App Component (formerly HomeScreen) ---

export default function App() {
  const isConnected = useHMSStore(selectIsConnectedToRoom);
  const hmsActions = useHMSActions();
  const peers = useHMSStore(selectPeers);
  const localPeer = useHMSStore(selectLocalPeer);

  const [userRole, setUserRole] = useState(null);
  const [lastPhotoUrl, setLastPhotoUrl] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  // This ref will hold a Map of { peerId: videoElement }
  const videoRefs = useRef(new Map());

  // Effect to handle leaving the room on window close
  useEffect(() => {
    const handleUnload = () => {
      if (isConnected) {
        hmsActions.leave();
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [hmsActions, isConnected]);

  // Effect to listen for completed photos from Firestore
  useEffect(() => {
    if (userRole !== "photographer") return;

    const q = collection(db, "photos");
    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "modified") {
          const data = change.doc.data();
          // Check if this photo was taken by the current photographer
          if (
            data.status === "completed" &&
            data.photographerId === localPeer?.id
          ) {
            console.log("Photo capture completed:", data.photoURL);
            setLastPhotoUrl(data.photoURL);
          }
        }
      });
    });

    return () => unsubscribe();
  }, [userRole, localPeer?.id]);

  /**
   * Uploads the photo data URL to Firebase Storage and updates Firestore.
   */
  const uploadAndSavePhoto = async (dataUrl, photographerId, clientId) => {
    setIsUploading(true);
    let docRef;
    try {
      // 1. Create a document in Firestore to get an ID
      docRef = await addDoc(collection(db, "photos"), {
        status: "uploading",
        photographerId,
        clientId,
        createdAt: new Date().toISOString(),
        photoURL: "",
      });
      console.log("Created Firestore document with ID:", docRef.id);

      // 2. Convert data URL to blob for upload
      const response = await fetch(dataUrl);
      const blob = await response.blob();

      // 3. Upload to Firebase Storage
      const photoStorageRef = storageRef(storage, `photos/${docRef.id}.png`);
      await uploadBytes(photoStorageRef, blob);

      // 4. Get the public download URL
      const downloadURL = await getDownloadURL(photoStorageRef);
      console.log("Photo uploaded, download URL:", downloadURL);

      // 5. Update the Firestore document with the URL and final status
      await updateDoc(doc(db, "photos", docRef.id), {
        photoURL: downloadURL,
        status: "completed",
      });
    } catch (e) {
      console.error("Error in upload process: ", e);
      if (docRef) {
        // If something failed, mark it as an error in Firestore
        await updateDoc(doc(db, "photos", docRef.id), { status: "error" });
      }
    } finally {
      setIsUploading(false);
    }
  };

  /**
   * The main function for the photographer to initiate a snapshot.
   */
  const handleTakePhoto = () => {
    // 1. Find the remote peer (the "client")
    const clientPeer = peers.find((p) => !p.isLocal);
    if (!clientPeer) {
      alert("No client found in the room to photograph.");
      return;
    }

    // 2. Get the client's video element from our ref map
    const videoElement = videoRefs.current.get(clientPeer.id);
    if (!videoElement || videoElement.readyState < 2) {
      // readyState check ensures video is playable
      alert("Client's video is not available or ready.");
      return;
    }

    try {
      // 3. Create the snapshot
      const dataUrl = createSnapshotFromVideo(videoElement);

      // 4. Start the upload and save process
      if (dataUrl) {
        uploadAndSavePhoto(dataUrl, localPeer.id, clientPeer.id);
      }
    } catch (e) {
      console.error("Error taking snapshot:", e);
      alert("Could not take snapshot. See console for details.");
    }
  };

  // --- Render Logic ---

  if (!isConnected) {
    return <JoinForm />;
  }

  // Role selection screen
  if (!userRole) {
    return (
      <div className="role-selection">
        <h2>Select Your Role</h2>
        <div className="role-buttons">
          <button
            className="btn btn-primary"
            onClick={() => setUserRole("photographer")}
          >
            I am the Photographer
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setUserRole("client")}
          >
            I am the Client
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <Conference videoRefs={videoRefs} />

      <div className="main-controls">
        {userRole === "photographer" && (
          <div className="photographer-panel">
            <button
              className="btn btn-capture"
              onClick={handleTakePhoto}
              disabled={isUploading}
            >
              {isUploading ? "Uploading..." : "📸 Take Photo of Client"}
            </button>
            {lastPhotoUrl && (
              <div className="photo-preview-container">
                <p>Last Photo Taken:</p>
                <a
                  href={lastPhotoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    src={lastPhotoUrl}
                    alt="Last snapshot taken"
                    className="photo-preview"
                  />
                </a>
              </div>
            )}
          </div>
        )}
        {userRole === "client" && (
          <div className="client-panel">
            <h2>Welcome!</h2>
            <p>The photographer will take your picture.</p>
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}

// NOTE: You need to wrap your main <App /> component in <HMSRoomProvider>
// from '@100mslive/react-sdk' for this to work in a real application.
