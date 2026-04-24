export type LogType = 'feeding' | 'sleep' | 'diaper' | 'health' | 'behavior' | 'medication';

export interface CareLog {
  id: string;
  type: LogType;
  timestamp: any; // Firestore Timestamp
  familyId: string;
  parentId: string;
  parentName?: string;
  details: {
    amount?: number; // ml/oz
    duration?: number; // minutes
    side?: 'left' | 'right' | 'both';
    quality?: 'good' | 'restless' | 'interrupted';
    location?: 'crib' | 'bassinet' | 'contact' | 'stroller';
    color?: string;
    texture?: string;
    temperature?: number;
    intensity?: 1 | 2 | 3 | 4 | 5; // Crying intensity
    symptoms?: string[];
    medicationName?: string;
  };
  note?: string;
  rawInput?: string;
}

export interface Family {
  id: string;
  babyName: string;
  birthDate?: string;
  parents: string[];
  weight?: string;
  height?: string;
  dailyChecklist?: {
    vitamins?: boolean;
    tummyTime?: boolean;
    bath?: boolean;
    date?: string;
  };
  vaccines?: {
    [key: string]: boolean; // e.g., 'hepB_birth': true
  };
  lastAction?: {
    type: LogType;
    timestamp: any;
    parentName: string;
  };
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  familyId?: string;
  photoURL?: string;
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: any;
}
