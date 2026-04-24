import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  doc, 
  getDocFromServer,
  collection,
  query,
  where,
  orderBy,
  limit,
  addDoc,
  onSnapshot,
  Timestamp,
  serverTimestamp,
  DocumentReference
} from 'firebase/firestore';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { FirestoreErrorInfo } from '../types';

const app = initializeApp(firebaseConfig);
// @ts-ignore
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log("Firebase connection verified");
  } catch (error: any) {
    if (error.message?.includes('offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}

export const handleFirestoreError = (error: any, operationType: any, path: string | null = null): never => {
  const user = auth.currentUser;
  const errorInfo: FirestoreErrorInfo = {
    error: error.message,
    operationType,
    path,
    authInfo: user ? {
      userId: user.uid,
      email: user.email,
      emailVerified: user.emailVerified,
      isAnonymous: user.isAnonymous,
      providerInfo: user.providerData.map(p => ({
        providerId: p.providerId,
        displayName: p.displayName,
        email: p.email
      }))
    } : null
  };
  throw new Error(JSON.stringify(errorInfo));
};
