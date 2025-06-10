import type { HMSPeer } from "@100mslive/react-sdk";
import {
  selectIsConnectedToRoom,
  selectPeers,
  useAVToggle,
  useHMSActions,
  useHMSStore,
  useVideo,
} from "@100mslive/react-sdk";
import { CameraType, CameraView, useCameraPermissions } from "expo-camera";
import { initializeApp } from "firebase/app";
import {
  addDoc,
  collection,
  doc,
  getFirestore,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import "./styles.css";

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

function JoinForm() {
  const hmsActions = useHMSActions();
  const [inputValues, setInputValues] = useState({
    name: "",
    token: "",
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValues((prevValues) => ({
      ...prevValues,
      [e.target.name]: e.target.value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const { name = "", token = "" } = inputValues;
    console.log("Joining room", name, token);

    // use room code to fetch auth token
    const authToken = await hmsActions.getAuthTokenByRoomCode({
      roomCode: token,
    });

    try {
      await hmsActions.join({ userName: name, authToken });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>Join Room</h2>
      <div className="input-container">
        <input
          required
          value={inputValues.name}
          onChange={handleInputChange}
          id="name"
          type="text"
          name="name"
          placeholder="Your name"
        />
      </div>
      <div className="input-container">
        <input
          id="token"
          type="text"
          name="token"
          placeholder="Room code"
          value={inputValues.token}
          onChange={handleInputChange}
        />
      </div>
      <button className="btn-primary">Join</button>
    </form>
  );
}

function Conference({ userRole }: { userRole: string }) {
  const peers = useHMSStore(selectPeers);

  return (
    <div className="conference-section">
      <h2>Conference</h2>

      <div className={`peers-container peers-${peers.length}`}>
        {peers
          .filter((peer) =>
            userRole === "photographer" ? true : !peer.isLocal
          )
          .map((peer) => (
            <Peer key={peer.id} peer={peer} />
          ))}
      </div>
    </div>
  );
}

function Peer({ peer }: { peer: HMSPeer }) {
  const { videoRef } = useVideo({
    trackId: peer.videoTrack,
  });

  const { isLocalVideoEnabled } = useAVToggle();
  const showVideo =
    peer.videoTrack && (peer.isLocal ? isLocalVideoEnabled : true);

  return (
    <div className="peer-container">
      {showVideo ? (
        <video
          ref={videoRef}
          className={`peer-video ${peer.isLocal ? "local" : ""}`}
          autoPlay
          muted
          playsInline
        />
      ) : (
        <div className="peer-initial-container peer-video">
          <div className="peer-initial">
            {peer.name ? peer.name.charAt(0).toUpperCase() : ""}
          </div>
        </div>
      )}
      <div className="peer-name">
        {peer.name} {peer.isLocal ? "(You)" : ""}
      </div>
    </div>
  );
}

function Footer() {
  const { isLocalAudioEnabled, isLocalVideoEnabled, toggleAudio, toggleVideo } =
    useAVToggle();
  return (
    <div className="control-bar">
      <button className="btn-control" onClick={toggleAudio}>
        {isLocalAudioEnabled ? "Mute" : "Unmute"}
      </button>
      <button className="btn-control" onClick={toggleVideo}>
        {isLocalVideoEnabled ? "Hide" : "Unhide"}
      </button>
    </div>
  );
}

export default function HomeScreen() {
  const isConnected = useHMSStore(selectIsConnectedToRoom);
  const hmsActions = useHMSActions();
  const [facing, setFacing] = useState<CameraType>("back");
  const [userRole, setUserRole] = useState<"photographer" | "client" | null>(
    null
  );
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [cameraPermission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const db = getFirestore(app);
  const storage = getStorage(app);

  useEffect(() => {
    window.onunload = () => {
      if (isConnected) {
        hmsActions.leave();
      }
    };
  }, [hmsActions, isConnected]);

  function toggleCameraFacing() {
    setFacing((current) => (current === "back" ? "front" : "back"));
  }

  const takePhoto = async (docId: string) => {
    if (!cameraPermission?.granted) {
      const permissionResult = await requestPermission();
      if (!permissionResult.granted) {
        alert("Camera permission not granted.");
        return;
      }
    }

    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync();
        if (photo) {
          setPhotoUri(photo.uri);
          await uploadPhoto(photo.uri, docId);
        }
      } catch (e) {
        console.error("Error taking picture: ", e);
      }
    }
  };

  const uploadPhoto = async (uri: string, docId: string) => {
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const storageRef = ref(storage, `photos/${docId}.jpg`);
      await uploadBytes(storageRef, blob);
      const downloadURL = await getDownloadURL(storageRef);
      console.log("Photo uploaded, download URL:", downloadURL);

      await updateDoc(doc(db, "photos", docId), {
        photoURL: downloadURL,
        status: "completed",
      });
    } catch (e) {
      console.error("Error uploading photo: ", e);
    }
  };

  // Photographer functions
  const handleTakePhotoForPhotographer = async () => {
    try {
      const docRef = await addDoc(collection(db, "photos"), {
        status: "pending",
        photographerId: "photographer123", // Replace with actual user ID
        timestamp: new Date().toISOString(),
      });
      console.log("Document written with ID: ", docRef.id);
    } catch (e) {
      console.error("Error adding document: ", e);
    }
  };

  // Client functions
  useEffect(() => {
    if (userRole === "client") {
      const unsubscribe = onSnapshot(collection(db, "photos"), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (
            change.type === "added" &&
            change.doc.data().status === "pending"
          ) {
            console.log("New pending photo request:", change.doc.data());
            takePhoto(change.doc.id);
          }
        });
      });
      return () => unsubscribe();
    }
    // Also listen for completed photos if the user is a photographer
    if (userRole === "photographer") {
      const unsubscribe = onSnapshot(collection(db, "photos"), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (
            change.type === "modified" &&
            change.doc.data().status === "completed" &&
            change.doc.data().photographerId === "photographer123"
          ) {
            console.log("Photo completed for photographer:", change.doc.data());
            setPhotoUri(change.doc.data().photoURL);
          }
        });
      });
      return () => unsubscribe();
    }
  }, [userRole, db]);

  if (userRole === null) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Select your role:</Text>
        <Button
          title="I am a Photographer"
          onPress={() => setUserRole("photographer")}
        />
        <Button title="I am a Client" onPress={() => setUserRole("client")} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isConnected ? (
        <>
          {userRole === "photographer" && <Conference userRole={userRole} />}
          <Footer />
          {userRole === "photographer" && (
            <>
              <Button
                title="Take Photo Request"
                onPress={handleTakePhotoForPhotographer}
              />
              {photoUri && (
                <View style={styles.photoPreviewContainer}>
                  <Text style={styles.message}>Last Photo Taken:</Text>
                  <Image
                    source={{ uri: photoUri }}
                    style={styles.photoPreview}
                  />
                </View>
              )}
            </>
          )}
          {userRole === "client" && (
            <CameraView style={styles.camera} facing={facing} ref={cameraRef}>
              <View style={styles.buttonContainer}>
                <TouchableOpacity
                  style={styles.button}
                  onPress={toggleCameraFacing}
                >
                  <Text style={styles.text}>Flip Camera</Text>
                </TouchableOpacity>
              </View>
            </CameraView>
          )}
        </>
      ) : (
        <JoinForm />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  message: {
    textAlign: "center",
    paddingBottom: 10,
    fontSize: 18,
  },
  camera: {
    flex: 1,
    width: "100%",
  },
  buttonContainer: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "transparent",
    margin: 64,
  },
  button: {
    flex: 1,
    alignSelf: "flex-end",
    alignItems: "center",
  },
  text: {
    fontSize: 24,
    fontWeight: "bold",
    color: "white",
  },
  photoPreviewContainer: {
    marginTop: 20,
    alignItems: "center",
  },
  photoPreview: {
    width: 200,
    height: 200,
    resizeMode: "contain",
    marginTop: 10,
  },
});
