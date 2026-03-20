// Firebase configuration & initialization
const firebaseConfig = {
    apiKey: "AIzaSyBYTFoMl-7yV6knvbHikVHRN8dlbyIil6A",
    authDomain: "kendo-bracket.firebaseapp.com",
    projectId: "kendo-bracket",
    storageBucket: "kendo-bracket.firebasestorage.app",
    messagingSenderId: "837468107917",
    appId: "1:837468107917:web:163051cf69519877cbdec4"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
