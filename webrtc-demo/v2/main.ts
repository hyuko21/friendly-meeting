import '../src/style.css';

import { initializeApp } from "firebase/app";
import { getFirestore, doc, collection, setDoc, addDoc, onSnapshot, getDoc, updateDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBBuRnkZ5XaztO43MNifPRUQiuqkdgkNM4",
  authDomain: "vrdev-experiments.firebaseapp.com",
  projectId: "vrdev-experiments",
  storageBucket: "vrdev-experiments.firebasestorage.app",
  messagingSenderId: "491180868265",
  appId: "1:491180868265:web:a5c4088015245ded359fb8",
  measurementId: "G-DESH4FS7QP"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const firestore = getFirestore(app);

// 1. Setup RTC Connection
const servers: RTCConfiguration = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};
const pc = new RTCPeerConnection(servers);

// 2. Setup Media Streams
let localStream: MediaStream | null = null;
let remoteStream: MediaStream | null = null;
let callId: string | null = null;

// const webcamButton = document.getElementById('webcamButton')!;
const webcamVideo = document.getElementById('webcamVideo')!;
const remoteVideo = document.getElementById('remoteVideo')!;
const callButton = document.getElementById('callButton')!;
const callInput = document.getElementById('callInput')!;
const answerButton = document.getElementById('answerButton')!;
// const hangupButton = document.getElementById('hangupButton')!;

document.addEventListener('DOMContentLoaded', async () => {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
    }
  });
  remoteStream = new MediaStream();

  // Push track from local stream to peer connection
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream!);
  });

  // Pull tracks from remote stream, add to video stream
  pc.ontrack = event => {
    event.streams[0].getTracks().forEach(track => {
      remoteStream!.addTrack(track);
    });
  };

  // Set video stream to video element
  (webcamVideo as HTMLMediaElement).srcObject = localStream;
  (remoteVideo as HTMLMediaElement).srcObject = remoteStream;
  (callButton as HTMLButtonElement).disabled = false;
  (answerButton as HTMLButtonElement).disabled = false;
  // (webcamButton as HTMLButtonElement).disabled = true;

  await checkCall();
});

// webcamButton.onclick = async () => {
//   localStream = await navigator.mediaDevices.getUserMedia({
//     video: true,
//   });
//   remoteStream = new MediaStream();
  
//   // Push track from local stream to peer connection
//   localStream.getTracks().forEach(track => {
//     pc.addTrack(track, localStream!);
//   });

//   // Pull tracks from remote stream, add to video stream
//   pc.ontrack = event => {
//     event.streams[0].getTracks().forEach(track => {
//       remoteStream!.addTrack(track);
//     });
//   };
  
//   // Set video stream to video element
//   (webcamVideo as HTMLMediaElement).srcObject = localStream;
//   (remoteVideo as HTMLMediaElement).srcObject = remoteStream;
//   (callButton as HTMLButtonElement).disabled = false;
//   (answerButton as HTMLButtonElement).disabled = false;
//   (webcamButton as HTMLButtonElement).disabled = true;
// };

// 3. Setup call
callButton.onclick = async () => {
  // Referene Firestore collection
  const callDoc = await addDoc(collection(firestore, 'calls'), {});
  const offerCandidates = collection(callDoc, 'offerCandidates');
  const answerCandidates = collection(callDoc, 'answerCandidates');

  // Get candidates for caller, save to db
  pc.onicecandidate = event => {
    event.candidate && addDoc(offerCandidates, event.candidate.toJSON());
  };

  // Create offer
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  // Save offer to db
  await setDoc(callDoc, { offer });

  const callLink = document.getElementById('callLink')!;
  (callLink as HTMLDivElement).style.display = 'block';
  (callLink as HTMLAnchorElement).textContent = `${window.location.origin}/v2/index.html?callId=${callDoc.id}`;

  // Listen for remote answer
  onSnapshot(callDoc, snapshot => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
    }
  });

  // When answered, add candidate to peer connection
  onSnapshot(answerCandidates, snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });
};

callInput.onchange = callInput.onkeyup = () => {
  callId = (callInput as HTMLInputElement).value;
  const sanitizedCallId = callId?.trim().replace(/[^a-zA-Z0-9]/g, '');
  if (sanitizedCallId) {
    (answerButton as HTMLButtonElement).disabled = false;
  } else {
    (answerButton as HTMLButtonElement).disabled = true;
  }
  callId = sanitizedCallId;
};

// 4. Answer call
answerButton.onclick = async () => {
  const callId = (callInput as HTMLInputElement).value;
  const callDoc = doc(firestore, 'calls', callId);
  const callData = (await getDoc(callDoc)).data();

  if (!callData) {
    alert('Call not found');
    return;
  }

  const answerCandidates = collection(callDoc, 'answerCandidates');
  const offerCandidates = collection(callDoc, 'offerCandidates');

  pc.onicecandidate = event => {
    event.candidate && addDoc(answerCandidates, event.candidate.toJSON());
  };

  const offerDescription = callData?.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    sdp: answerDescription.sdp,
    type: answerDescription.type,
  };

  await updateDoc(callDoc, { answer });

  onSnapshot(offerCandidates, snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });
};

async function checkCall() {
  const url = new URL(window.location.href);
  const callId = url.searchParams.get('callId');

  console.log('callId', callId);
  console.log('url', url);

  if (!callId) {
    return;
  }

    const callDoc = doc(firestore, 'calls', callId);
  const callData = (await getDoc(callDoc)).data();

  if (!callData) {
    alert('Call not found');
    return;
  }

  const answerCandidates = collection(callDoc, 'answerCandidates');
  const offerCandidates = collection(callDoc, 'offerCandidates');

  pc.onicecandidate = event => {
    event.candidate && addDoc(answerCandidates, event.candidate.toJSON());
  };

  const offerDescription = callData?.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    sdp: answerDescription.sdp,
    type: answerDescription.type,
  };

  await updateDoc(callDoc, { answer });

  onSnapshot(offerCandidates, snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });
}