import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  auth, 
  createUserProfile, 
  getUserProfile, 
  UserProfile, 
  FirebaseUser, 
  getAuthErrorMessage,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile
} from '../services/firebase';

interface AuthContextType {
  currentUser: FirebaseUser | null;
  userProfile: UserProfile | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  register: (fullName: string, email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Load user profile from Firestore or fallback
  const fetchUserProfile = async (user: FirebaseUser) => {
    try {
      const profile = await getUserProfile(user.uid);
      if (profile) {
        setUserProfile(profile);
      } else {
        // If firestore doc not yet populated, create fallback from user metadata
        const fallback: UserProfile = {
          userId: user.uid,
          fullName: user.displayName || user.email?.split('@')[0] || 'Quality Inspector',
          email: user.email || '',
          createdAt: user.metadata.creationTime || new Date().toISOString(),
        };
        setUserProfile(fallback);
      }
    } catch (err) {
      console.warn('Could not fetch Firestore user profile, using Auth fallback:', err);
      const fallback: UserProfile = {
        userId: user.uid,
        fullName: user.displayName || user.email?.split('@')[0] || 'Quality Inspector',
        email: user.email || '',
        createdAt: user.metadata.creationTime || new Date().toISOString(),
      };
      setUserProfile(fallback);
    }
  };

  useEffect(() => {
    // Listen to Firebase Auth state persistence
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        await fetchUserProfile(user);
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async (email: string, pass: string) => {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), pass);
    if (cred.user) {
      await fetchUserProfile(cred.user);
    }
  };

  const register = async (fullName: string, email: string, pass: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), pass);
    const user = cred.user;

    // Update display name in Firebase Auth
    try {
      await updateProfile(user, { displayName: fullName.trim() });
    } catch (e) {
      console.warn('Error updating profile display name:', e);
    }

    // Create user profile in Firestore
    const newProfile: UserProfile = {
      userId: user.uid,
      fullName: fullName.trim(),
      email: user.email || email.trim(),
      createdAt: new Date().toISOString(),
    };

    await createUserProfile(newProfile);
    setUserProfile(newProfile);
  };

  const logout = async () => {
    await signOut(auth);
    setCurrentUser(null);
    setUserProfile(null);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  };

  const refreshProfile = async () => {
    if (currentUser) {
      await fetchUserProfile(currentUser);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        loading,
        login,
        register,
        logout,
        resetPassword,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
