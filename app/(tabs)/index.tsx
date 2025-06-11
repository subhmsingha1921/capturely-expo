import {
  selectHMSMessages,
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

const firebaseConfig = {
  apiKey: "AIzaSyBVFOKzAzAAdqGnhPfkrzV_5G5ugaqzGFo",
  authDomain: "collabgpt-dev.firebaseapp.com",
  databaseURL: "https://collabgpt-dev-default-rtdb.firebaseio.com",
  projectId: "collabgpt-dev",
  storageBucket: "collabgpt-dev.appspot.com",
  messagingSenderId: "262626681862",
  appId: "1:262626681862:web:aa52d3633154720f960f87",
  measurementId: "G-ESM7KPV7JM",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// --- Constants ---
const RESOLUTIONS = {
  "640x480": { width: 640, height: 480 },
  "1280x720": { width: 1280, height: 720 },
  "1920x1080": { width: 1920, height: 1080 },
  "3840x2160": { width: 3840, height: 2160 },
};

// --- Helper Functions for Snapshot ---
const captureAndUploadLocalPhoto = async (track, photographerId, clientId) => {
  if (!track) {
    console.error("Client: No local video track found to capture.");
    return null;
  }

  let blob;
  try {
    // Try the high-quality ImageCapture API first
    const imageCapture = new ImageCapture(track);
    blob = await imageCapture.takePhoto();
    console.log("Client: Captured photo using ImageCapture API.");
  } catch (error) {
    console.warn("Client: ImageCapture failed, falling back to canvas.", error);
    // Fallback to canvas method if ImageCapture is not supported or fails
    const video = document.createElement("video");
    video.srcObject = new MediaStream([track]);
    await video.play(); // Play to get the video dimensions

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  if (!blob) {
    console.error("Client: Failed to capture photo using any method.");
    return null;
  }

  // The rest of this is the upload logic, now running on the client
  try {
    const docRef = await addDoc(collection(db, "photos"), {
      status: "uploading",
      photographerId,
      clientId,
      createdAt: new Date().toISOString(),
      photoURL: "",
    });
    const photoStorageRef = storageRef(storage, `photos/${docRef.id}.png`);
    await uploadBytes(photoStorageRef, blob);
    const downloadURL = await getDownloadURL(photoStorageRef);
    await updateDoc(doc(db, "photos", docRef.id), {
      photoURL: downloadURL,
      status: "completed",
    });
    return downloadURL;
  } catch (e) {
    console.error("Client: Error in upload process: ", e);
    return null;
  }
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
          videoRef(el);
          if (el) {
            videoRefs.current.set(peer.id, el);
          } else {
            videoRefs.current.delete(peer.id);
          }
        }}
        className="peer-video"
        autoPlay
        muted={isLocal}
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
        className="btn btn-control"
        onClick={() => hmsActions.switchCamera()}
      >
        Switch Camera
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

export default function App() {
  const isConnected = useHMSStore(selectIsConnectedToRoom);
  const hmsActions = useHMSActions();
  const peers = useHMSStore(selectPeers);
  const localPeer = useHMSStore(selectLocalPeer);
  const messages = useHMSStore(selectHMSMessages);

  const [userRole, setUserRole] = useState(null);
  const [lastPhotoUrl, setLastPhotoUrl] = useState(null);
  const [photoState, setPhotoState] = useState("idle"); // idle, waiting_ack, uploading
  const [selectedResolution, setSelectedResolution] = useState("640x480");

  const videoRefs = useRef(new Map());

  // --- Core Snapshot Logic ---

  // EFFECT 1: Runs on the CLIENT, listening for the command to take a photo.
  useEffect(() => {
    if (userRole !== "client" || !messages.length) return;

    const lastMessage = messages[messages.length - 1];
    if (
      lastMessage.type === "TAKE_PHOTO_COMMAND" &&
      lastMessage.sender !== localPeer?.id
    ) {
      console.log("Client: Received photo command", lastMessage.message);
      const { resolution, photographerId } = JSON.parse(lastMessage.message);

      const takePhoto = async () => {
        try {
          // 1. Set the resolution
          await hmsActions.setVideoSettings(resolution);
          console.log("Client: Resolution change requested.");

          // 2. Wait for camera to stabilize
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second

          // 3. Capture and upload the photo
          const localVideoTrack = localPeer?.videoTrack;
          const track = hmsActions.getTrackById(localVideoTrack);
          const downloadURL = await captureAndUploadLocalPhoto(
            track?.nativeTrack,
            photographerId,
            localPeer?.id
          );

          // 4. Send the result back to the photographer
          if (downloadURL) {
            hmsActions.sendDirectMessage(
              downloadURL,
              photographerId,
              "PHOTO_COMPLETE"
            );
          } else {
            hmsActions.sendDirectMessage(
              "error",
              photographerId,
              "PHOTO_FAILED"
            );
          }
        } catch (err) {
          console.error("Client: Photo capture process failed", err);
          hmsActions.sendDirectMessage("error", photographerId, "PHOTO_FAILED");
        }
      };

      takePhoto();
    }
  }, [messages, userRole, hmsActions, localPeer]);

  // EFFECT 2: Runs on the PHOTOGRAPHER, listening for the final photo URL.
  useEffect(() => {
    if (userRole !== "photographer" || !messages.length) return;

    const lastMessage = messages[messages.length - 1];

    if (lastMessage.type === "PHOTO_COMPLETE") {
      console.log(
        "Photographer: Received completed photo URL.",
        lastMessage.message
      );
      setLastPhotoUrl(lastMessage.message);
      setPhotoState("idle"); // Reset the state
    } else if (lastMessage.type === "PHOTO_FAILED") {
      console.error("Photographer: Client reported photo failure.");
      alert("The client was unable to take the photo. Please try again.");
      setPhotoState("idle");
    }
  }, [messages, userRole]);

  const handleTakePhotoRequest = () => {
    if (photoState !== "idle") return;

    const clientPeer = peers.find((p) => !p.isLocal);
    if (!clientPeer) {
      alert("No client found in the room to photograph.");
      return;
    }

    console.log(
      `Photographer: Commanding client to take a ${selectedResolution} photo.`
    );
    const message = JSON.stringify({
      resolution: RESOLUTIONS[selectedResolution],
      photographerId: localPeer?.id,
    });

    try {
      hmsActions.sendDirectMessage(
        message,
        clientPeer.id,
        "TAKE_PHOTO_COMMAND"
      );
      setPhotoState("waiting_for_photo");
    } catch (error) {
      // Catch the error, log it, and notify the user without crashing.
      console.error("Failed to send photo request:", error);
      alert(
        "Could not send request to the client. They may have left the room. Please try again."
      );

      // Reset the state so the photographer can try again.
      setPhotoState("idle");
    }
  };

  // --- Render Logic ---

  if (!isConnected) return <JoinForm />;

  if (!userRole) {
    return (
      <div className="join-form-container">
        <div className="join-form">
          <h2 className="form-title">Select Your Role</h2>
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
      </div>
    );
  }

  return (
    <div className="app-container">
      <Conference videoRefs={videoRefs} />

      <div className="main-controls">
        {userRole === "photographer" && (
          <div className="photographer-panel">
            <div className="photo-actions">
              <label htmlFor="resolution-select">Resolution:</label>
              <select
                id="resolution-select"
                className="resolution-select"
                value={selectedResolution}
                onChange={(e) => setSelectedResolution(e.target.value)}
                disabled={photoState !== "idle"}
              >
                {Object.keys(RESOLUTIONS).map((res) => (
                  <option key={res} value={res}>
                    {res}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-capture"
                onClick={handleTakePhotoRequest}
                disabled={photoState !== "idle"}
              >
                {photoState === "idle" && "📸 Take Photo"}
                {photoState === "waiting_for_photo" && "Waiting for Photo..."}
              </button>
            </div>
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
                    alt="Last snapshot"
                    className="photo-preview"
                  />
                </a>
              </div>
            )}
          </div>
        )}
        {userRole === "client" && (
          <div className="client-panel">
            <h2>Welcome! The photographer will take your picture.</h2>
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}
