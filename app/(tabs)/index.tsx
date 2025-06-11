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
  const photoRequestRef = useRef(null);

  // --- Core Snapshot Logic ---

  // This effect runs on the CLIENT's device, listening for requests from the photographer
  useEffect(() => {
    if (userRole !== "client" || !messages.length) return;

    const lastMessage = messages[messages.length - 1];
    if (
      lastMessage.type === "REQUEST_RESOLUTION" &&
      lastMessage.sender !== localPeer?.id
    ) {
      console.log("Client: Received resolution request", lastMessage.message);
      const { resolution, photographerId } = JSON.parse(lastMessage.message);

      hmsActions
        .setVideoSettings(resolution)
        .then(() => {
          console.log("Client: Resolution changed successfully.");
          hmsActions.sendDirectMessage("ack", photographerId, "RESOLUTION_ACK");
        })
        .catch((err) =>
          console.error("Client: Failed to set video settings", err)
        );
    }
  }, [messages, userRole, hmsActions, localPeer?.id]);

  // This effect runs on the PHOTOGRAPHER's device, listening for acknowledgment
  useEffect(() => {
    if (
      userRole !== "photographer" ||
      !messages.length ||
      photoState !== "waiting_ack"
    )
      return;

    const lastMessage = messages[messages.length - 1];
    if (
      lastMessage.type === "RESOLUTION_ACK" &&
      lastMessage.sender === photoRequestRef.current?.clientId
    ) {
      console.log("Photographer: Received ACK from client. Taking snapshot.");
      const { clientId, photographerId } = photoRequestRef.current;
      const videoElement = videoRefs.current.get(clientId);

      if (videoElement && videoElement.readyState >= 2) {
        // Use a short timeout to allow the camera to stabilize at the new resolution
        setTimeout(() => {
          const dataUrl = createSnapshotFromVideo(videoElement);
          if (dataUrl) {
            uploadAndSavePhoto(dataUrl, photographerId, clientId);
          }
        }, 500);
      } else {
        console.error("Client video not ready for snapshot.");
        setPhotoState("idle");
      }
    }
  }, [messages, userRole, photoState]);

  const uploadAndSavePhoto = async (dataUrl, photographerId, clientId) => {
    setPhotoState("uploading");
    try {
      const docRef = await addDoc(collection(db, "photos"), {
        status: "uploading",
        photographerId,
        clientId,
        createdAt: new Date().toISOString(),
        photoURL: "",
      });
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const photoStorageRef = storageRef(storage, `photos/${docRef.id}.png`);
      await uploadBytes(photoStorageRef, blob);
      const downloadURL = await getDownloadURL(photoStorageRef);
      await updateDoc(doc(db, "photos", docRef.id), {
        photoURL: downloadURL,
        status: "completed",
      });
      setLastPhotoUrl(downloadURL);
    } catch (e) {
      console.error("Error in upload process: ", e);
    } finally {
      setPhotoState("idle");
      photoRequestRef.current = null;
    }
  };

  const handleTakePhotoRequest = () => {
    if (photoState !== "idle") return;

    const clientPeer = peers.find((p) => !p.isLocal);
    if (!clientPeer) {
      alert("No client found in the room to photograph.");
      return;
    }

    console.log(
      `Photographer: Requesting ${selectedResolution} from client ${clientPeer.id}`
    );
    const message = JSON.stringify({
      resolution: RESOLUTIONS[selectedResolution],
      photographerId: localPeer?.id,
    });

    try {
      hmsActions.sendDirectMessage(
        message,
        clientPeer.id,
        "REQUEST_RESOLUTION"
      );
      setPhotoState("waiting_ack");
      photoRequestRef.current = {
        clientId: clientPeer.id,
        photographerId: localPeer?.id,
      };
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
                {photoState === "waiting_ack" && "Waiting for Client..."}
                {photoState === "uploading" && "Uploading..."}
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
