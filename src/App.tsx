import React, { useState, useEffect, useCallback } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  limit, 
  onSnapshot,
  addDoc,
  serverTimestamp,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  deleteDoc
} from 'firebase/firestore';
import { auth, db, googleProvider } from './lib/firebase';
import { Family, CareLog, UserProfile, LogType } from './types';
import { 
  Baby, 
  Moon, 
  Utensils, 
  Droplets, 
  Plus, 
  Send, 
  Activity, 
  ShieldAlert, 
  LogOut,
  Clock,
  User as UserIcon,
  Mic,
  LayoutDashboard,
  Bell,
  BarChart3,
  Calendar,
  Trash2,
  Filter,
  Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, formatDistanceToNow, differenceInDays, differenceInWeeks, differenceInMonths, isToday, isYesterday } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  AreaChart,
  Area,
  ReferenceLine,
  Dot
} from 'recharts';
import { processCareInput } from './lib/gemini';
import ReactMarkdown from 'react-markdown';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Tab = 'dashboard' | 'timeline' | 'notifications' | 'insights' | 'settings';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [family, setFamily] = useState<Family | null>(null);
  const [logs, setLogs] = useState<CareLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<any>(null);
  const [reminderActive, setReminderActive] = useState<boolean>(false);
  const [nightMode, setNightMode] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [weather, setWeather] = useState<{ temp: number, condition: string } | null>(null);
  const [showQuickLog, setShowQuickLog] = useState<LogType | null>(null);
  const getInitialModel = () => {
    const saved = localStorage.getItem('custom_gemini_model');
    if (saved === 'gemini-3-flash-preview' || saved === 'gemini-3.1-pro-preview') {
      return saved;
    }
    return 'gemini-3-flash-preview';
  };

  const [apiSettings, setApiSettings] = useState({
    apiKey: localStorage.getItem('custom_gemini_key') || '',
    model: getInitialModel()
  });

  const toggleChecklist = async (key: string) => {
    if (!profile?.familyId || !family) return;
    const today = format(new Date(), 'yyyy-MM-dd');
    const currentList = (family.dailyChecklist && family.dailyChecklist.date === today) 
      ? family.dailyChecklist 
      : { date: today, vitamins: false, tummyTime: false, bath: false };
    
    try {
      await updateDoc(doc(db, 'families', profile.familyId), {
        dailyChecklist: {
          ...currentList,
          [key]: !((currentList as any)[key])
        }
      });
    } catch (err) {
      console.error("Checklist Sync Error:", err);
    }
  };

  const toggleVaccine = async (key: string) => {
    if (!profile?.familyId || !family) return;
    const currentVaccines = family.vaccines || {};
    try {
      await updateDoc(doc(db, 'families', profile.familyId), {
        vaccines: {
          ...currentVaccines,
          [key]: !currentVaccines[key]
        }
      });
    } catch (err) {
      console.error("Vaccine Sync Error:", err);
    }
  };

  const repairSync = async () => {
    if (!user || !profile?.familyId) return;
    try {
       const familyRef = doc(db, 'families', profile.familyId);
       await updateDoc(familyRef, {
         parents: arrayUnion(user.uid)
       });
       alert("Permissions Synchronized Successfully!");
    } catch (e: any) {
       console.error("Sync Repair Failed:", e);
       alert("Sync Repair Failed: " + e.message);
    }
  };

  // derived stats
  const dailyStats = logs.filter(l => {
    if (!l.timestamp) return true; 
    
    const ts = l.timestamp;
    let logDate;
    if (typeof ts.toDate === 'function') {
      logDate = ts.toDate();
    } else if (ts instanceof Date) {
      logDate = ts;
    } else if (ts.seconds) {
      logDate = new Date(ts.seconds * 1000);
    } else {
      logDate = new Date();
    }
    
    // Use a 24 hour window instead of strict calendar day to prevent timezone mismatches
    const msIn24h = 24 * 60 * 60 * 1000;
    return (Date.now() - logDate.getTime()) < msIn24h;
  });

  const totalMilk = dailyStats
    .filter(l => l.type?.toLowerCase() === 'feeding' || l.type?.toLowerCase() === 'milk')
    .reduce((sum, l) => {
      const details = l.details || {};
      const amt = parseFloat(String(details.amount || details.volume || details.ml || l.amount || l.volume || 0));
      return sum + (isNaN(amt) ? 0 : amt);
    }, 0);

  const totalSleepMinutes = dailyStats
    .filter(l => l.type?.toLowerCase() === 'sleep' || l.type?.toLowerCase() === 'rest')
    .reduce((sum, l) => {
      const details = l.details || {};
      const dur = parseFloat(String(details.duration || details.minutes || details.mins || details.min || l.duration || l.minutes || 0));
      return sum + (isNaN(dur) ? 0 : dur);
    }, 0);
  
  const totalDiapers = dailyStats.filter(l => l.type === 'diaper').length;

  const feedingLogs = logs.filter(l => l.type?.toLowerCase() === 'feeding' || l.type?.toLowerCase() === 'milk');
  
  const avgFeedingAmount = feedingLogs.length > 0 
    ? Math.round(feedingLogs.reduce((sum, l) => {
        const amt = parseFloat(String(l.details?.amount || l.details?.volume || l.amount || l.volume || 0));
        return sum + (isNaN(amt) ? 0 : amt);
      }, 0) / feedingLogs.length)
    : 0;

  // Calculate Average Gap (in hours)
  let avgFeedingGap = 0;
  if (feedingLogs.length > 1) {
    const gaps: number[] = [];
    for (let i = 0; i < feedingLogs.length - 1; i++) {
      const current = (feedingLogs[i].timestamp && typeof feedingLogs[i].timestamp.toDate === 'function') ? feedingLogs[i].timestamp.toDate().getTime() : Date.now();
      const next = (feedingLogs[i+1].timestamp && typeof feedingLogs[i+1].timestamp.toDate === 'function') ? feedingLogs[i+1].timestamp.toDate().getTime() : Date.now();
      gaps.push(Math.abs(current - next) / (1000 * 60 * 60));
    }
    avgFeedingGap = Number((gaps.reduce((sum, g) => sum + g, 0) / gaps.length).toFixed(1));
  }

  const feedingData = feedingLogs
    .slice(0, 10)
    .reverse()
    .map(l => {
      const amt = parseFloat(String(l.details?.amount || l.details?.volume || l.amount || l.volume || 0));
      return {
        time: format((l.timestamp && typeof l.timestamp.toDate === 'function') ? l.timestamp.toDate() : new Date(), 'HH:mm'),
        amount: isNaN(amt) ? 0 : amt
      };
    });
  
  const sleepLogs = logs.filter(l => l.type?.toLowerCase() === 'sleep' || l.type?.toLowerCase() === 'rest');
  
  const avgSleepDuration = sleepLogs.length > 0
    ? Math.round(sleepLogs.reduce((sum, l) => {
        const dur = parseFloat(String(l.details?.duration || l.details?.minutes || l.duration || l.minutes || 0));
        return sum + (isNaN(dur) ? 0 : dur);
      }, 0) / sleepLogs.length)
    : 0;

  const sleepData = sleepLogs
    .slice(0, 10)
    .reverse()
    .map(l => {
      const dur = parseFloat(String(l.details?.duration || l.details?.minutes || l.duration || l.minutes || 0));
      return {
        time: format((l.timestamp && typeof l.timestamp.toDate === 'function') ? l.timestamp.toDate() : new Date(), 'HH:mm'),
        duration: isNaN(dur) ? 0 : dur
      };
    });

  const diaperStats = logs.filter(l => l.type?.toLowerCase() === 'diaper').length;
  const recentMedications = logs.filter(l => l.type?.toLowerCase().startsWith('med') || l.type?.toLowerCase() === 'health').slice(0, 5);

  // Auth & Profile Listener
  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      try {
        setUser(u);
        if (u) {
          // Try to get user profile
          let userDoc = await getDoc(doc(db, 'users', u.uid));
          let currentProfile: UserProfile;
          
          if (!userDoc.exists()) {
            console.log("No user profile found, creating one...");
            const defaultFamilyId = 'xavian-family-1';
            currentProfile = {
              uid: u.uid,
              displayName: u.displayName || 'Parent',
              email: u.email || '',
              familyId: defaultFamilyId,
              photoURL: u.photoURL || ''
            };
            await setDoc(doc(db, 'users', u.uid), currentProfile);
          } else {
            console.log("User profile loaded.");
            currentProfile = userDoc.data() as UserProfile;
          }

          setProfile(currentProfile);

          // SELF-HEALING MEMBERSHIP: Ensure user is in families/{familyId}.parents
          if (currentProfile.familyId) {
            const familyRef = doc(db, 'families', currentProfile.familyId);
            const familySnap = await getDoc(familyRef);
            
            if (!familySnap.exists()) {
              console.log("Initializing new family vault...");
              await setDoc(familyRef, {
                babyName: 'Xavian Faris',
                birthDate: '2025-09-01',
                parents: [u.uid],
                lastAction: null,
                weight: '3.4',
                height: '51'
              });
            } else {
              const familyData = familySnap.data();
              if (familyData && !familyData.parents.includes(u.uid)) {
                console.log("Syncing membership permissions...");
                await updateDoc(familyRef, {
                  parents: arrayUnion(u.uid)
                });
              }
            }
          }
        }
      } catch (e: any) {
        console.error("Critical Auth/Profile Error:", e);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  // Family Listener
  useEffect(() => {
    if (!profile?.familyId || !user) return;
    
    // Use an error handler and only set state if document exists
    const unsubscribe = onSnapshot(doc(db, 'families', profile.familyId), 
      (docSnap) => {
        if (docSnap.exists()) {
          setFamily({ id: docSnap.id, ...docSnap.data() } as Family);
        } else {
          console.log("Family document does not exist yet.");
        }
      },
      (error) => {
        console.warn("Family listener error (usually transient during init):", error.message);
      }
    );
    return () => unsubscribe();
  }, [profile?.familyId, user]);

  // Weather Effect
  useEffect(() => {
    if (!navigator.geolocation) return;
    
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const { latitude, longitude } = pos.coords;
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`);
        const data = await res.json();
        if (data.current_weather) {
          setWeather({ 
            temp: Math.round(data.current_weather.temperature), 
            condition: data.current_weather.weathercode <= 3 ? 'Clear' : 'Cloudy' 
          });
        }
      } catch (e) {
        console.error("Weather fetch failed", e);
      }
    });
  }, []);

  // Baby Age Calculation
  const getBabyAge = () => {
    if (!family?.birthDate) return 'Newborn';
    const birth = new Date(family.birthDate);
    const now = new Date();
    
    const months = differenceInMonths(now, birth);
    if (months > 0) return `${months} Month${months > 1 ? 's' : ''}`;
    
    const weeks = differenceInWeeks(now, birth);
    if (weeks > 0) return `${weeks} Week${weeks > 1 ? 's' : ''}`;
    
    const days = differenceInDays(now, birth);
    return `${days} Day${days > 1 ? 's' : ''}`;
  };

  // Logs Listener
  useEffect(() => {
    if (!profile?.familyId || !user) return;
    
    // Safety check: only start listener if we are confirmed parents (or if family is still loading)
    if (family && !family.parents.includes(user.uid)) return;

    const q = query(
      collection(db, 'families', profile.familyId, 'logs'),
      orderBy('timestamp', 'desc'),
      limit(500)
    );

    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        setLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CareLog)));
      },
      (error) => {
        console.warn("Logs listener error:", error.message);
      }
    );
    return () => unsubscribe();
  }, [profile?.familyId, user, family?.parents?.length]);

  // Request Notification Permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const triggerLocalNotification = useCallback((message: string, minutes: number) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    
    setTimeout(() => {
      new Notification("Xavian Care AI Reminder", {
        body: message,
        icon: "https://cdn-icons-png.flaticon.com/512/3257/3257217.png"
      });
      setReminderActive(false);
    }, minutes * 60000);
    setReminderActive(true);
  }, []);

  const submitLog = async (manualInput?: string) => {
    const textToProcess = manualInput || input;
    if (!textToProcess.trim() || !profile?.familyId || !user) return;
    setIsProcessing(true);
    setAiFeedback(null);

    try {
      const result = await processCareInput(textToProcess, {
        lastFeeding: logs.find(l => l.type === 'feeding'),
        lastSleep: logs.find(l => l.type === 'sleep'),
      }, {
        apiKey: apiSettings.apiKey,
        model: apiSettings.model
      });

      if (result.structuredLog) {
        await addDoc(collection(db, 'families', profile.familyId, 'logs'), {
          ...result.structuredLog,
          familyId: profile.familyId,
          parentId: user.uid,
          parentName: profile.displayName,
          timestamp: serverTimestamp(),
          rawInput: textToProcess
        });

        await updateDoc(doc(db, 'families', profile.familyId), {
          lastAction: {
            type: result.structuredLog.type,
            timestamp: serverTimestamp(),
            parentName: profile.displayName
          }
        });
      }

      if (result.reminderInMinutes) {
        triggerLocalNotification(`Time for ${result.structuredLog?.type || 'next care activity'}!`, result.reminderInMinutes);
      }

      setAiFeedback(result);
      if (!manualInput) setInput('');
    } catch (error) {
      console.error("AI Logging Error:", error);
      setAiFeedback({ 
        aiResponse: "I encountered a sync issue, but your loop is still secure. Please verify your connection or API key.",
        intent: "general_query"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const deleteLog = async (logId: string) => {
    if (!profile?.familyId || !logId) return;
    try {
      await deleteDoc(doc(db, 'families', profile.familyId, 'logs', logId));
    } catch (e) {
      console.error("Delete failed:", e);
    }
  };

  if (loading) return <LoadingScreen />;
  if (!user) return <AuthScreen handleLogin={() => signInWithPopup(auth, googleProvider)} />;

  return (
    <div className={cn(
      "h-screen flex flex-col font-sans transition-all duration-700 ease-out overflow-hidden select-none",
      nightMode ? "bg-night-bg text-slate-100" : "bg-baby-bg text-gray-900"
    )}>
      {/* Top App Bar - Slimmed Down */}
      <header className={cn(
        "shrink-0 z-40 px-5 py-3 flex items-center justify-between border-b backdrop-blur-xl transition-all",
        nightMode ? "bg-night-bg/90 border-slate-900" : "bg-white/90 border-gray-100"
      )}>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setNightMode(!nightMode)} 
            className={cn(
              "w-9 h-9 rounded-xl flex items-center justify-center shadow-lg transition-all active:scale-90",
              nightMode ? "bg-blue-600 shadow-blue-500/20" : "bg-blue-600 shadow-blue-100"
            )}
          >
            {nightMode ? <Moon size={18} className="text-white" /> : <Baby size={18} className="text-white" />}
          </button>
          <div>
            <h1 className={cn(
              "font-serif font-black text-xl tracking-tight leading-none", 
              nightMode ? "text-white" : "text-gray-900"
            )}>
              {family?.babyName}
            </h1>
            <div className="flex items-center gap-1.5 text-[8px] text-gray-400 font-black uppercase tracking-[0.2em] mt-0.5">
              <span className="w-1 h-1 rounded-full bg-green-500 animate-pulse" />
              Live Loop
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setEmergencyOpen(true)} 
            className="w-8 h-8 bg-red-50 text-red-600 rounded-xl flex items-center justify-center border border-red-100 active:scale-90 transition-all"
          >
            <ShieldAlert size={16} />
          </button>
          <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-white shadow-md" />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto w-full max-w-lg mx-auto px-4 py-4 space-y-4 scrollbar-hide">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div key="dash" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}>
               <DashboardView 
                 family={family} 
                 logs={logs} 
                 totalMilk={totalMilk} 
                 totalSleepMinutes={totalSleepMinutes} 
                 totalDiapers={totalDiapers} 
                 aiFeedback={null} // AI Feedback moved to floating bar
                 nightMode={nightMode} 
                 onQuickLog={(type: any) => {
                    let quickText = '';
                    if (type === 'feeding') quickText = 'Xavian just had 120ml milk.';
                    else if (type === 'feeding_left') quickText = 'Nursing session: Started on the LEFT side.';
                    else if (type === 'feeding_right') quickText = 'Nursing session: Started on the RIGHT side.';
                    else if (type === 'feeding_both') quickText = 'Full nursing session: Fed on BOTH sides.';
                    else if (type === 'sleep') quickText = 'Xavian slept for 30 minutes in the crib.';
                    else if (type === 'diaper') quickText = 'Just changed a wet diaper.';
                    else if (type === 'health') quickText = 'Checking health: temperature is 36.8';
                    else if (type === 'med_vitamin') quickText = 'Administered daily vitamin D drops.';
                    else if (type === 'med_tylenol') quickText = 'Gave infant tylenol for discomfort.';
                    else if (type === 'med_gas') quickText = 'Administered anti-gas drops.';
                    else if (type === 'soothe') quickText = "How can I soothe Xavian? He won't stop crying.";
                    else quickText = 'General health check: baby is stable.';
                    
                    submitLog(quickText);
                 }} 
                 setActiveTab={setActiveTab}
                 setAiFeedback={setAiFeedback}
                 babyAge={getBabyAge()}
                 weather={weather}
                 toggleChecklist={toggleChecklist}
                 onDeleteLog={deleteLog}
               />
            </motion.div>
          )}

          {activeTab === 'timeline' && (
            <motion.div key="logs" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
               <TimelineView logs={logs} nightMode={nightMode} onDeleteLog={deleteLog} />
            </motion.div>
          )}

          {activeTab === 'insights' && (
            <motion.div key="trends" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
                <TrendsView 
                  feedingData={feedingData} 
                  sleepData={sleepData}
                  logs={logs} 
                  nightMode={nightMode} 
                  family={family}
                  toggleVaccine={toggleVaccine}
                  avgFeedingAmount={avgFeedingAmount}
                  avgFeedingGap={avgFeedingGap}
                  avgSleepDuration={avgSleepDuration}
                  recentMedications={recentMedications}
                />
            </motion.div>
          )}

          {activeTab === 'notifications' && (
            <motion.div key="notif" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
               <h2 className={cn("px-2 text-sm font-black uppercase tracking-widest", nightMode ? "text-gray-500" : "text-gray-400")}>Active Alerts</h2>
               <AnimatePresence>
                 {reminderActive ? (
                   <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className={cn("p-5 rounded-[32px] border flex items-center gap-4 shadow-sm transition-colors", nightMode ? "bg-blue-900/20 border-blue-800" : "bg-blue-50/30 border-blue-100")}>
                     <div className="w-12 h-12 bg-blue-500 rounded-2xl flex items-center justify-center text-white shrink-0 shadow-lg shadow-blue-100">
                       <Bell size={24} />
                     </div>
                     <div className="flex-1">
                       <p className={cn("font-bold leading-tight", nightMode ? "text-white" : "text-gray-900")}>Upcoming Activity</p>
                       <p className="text-xs text-gray-400 font-medium italic">Pending notification scheduled...</p>
                     </div>
                     <button onClick={() => setReminderActive(false)} className="text-[10px] font-black text-blue-500 uppercase">Cancel</button>
                   </motion.div>
                 ) : (
                   <div className="text-center py-20 space-y-4">
                     <div className={cn("w-20 h-20 rounded-full mx-auto flex items-center justify-center transition-colors", nightMode ? "bg-slate-900 text-slate-800" : "bg-gray-100 text-gray-300")}>
                       <Bell size={40} />
                     </div>
                     <div>
                       <p className={cn("font-bold", nightMode ? "text-slate-500" : "text-gray-400")}>All set! No upcoming reminders.</p>
                       <p className="text-xs text-gray-400 max-w-[200px] mx-auto mt-2 italic">Try: "Remind me to feed Xavian in 2 hours"</p>
                     </div>
                   </div>
                 )}
               </AnimatePresence>
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div key="settings" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
               <SettingsView 
                 user={user} 
                 apiSettings={apiSettings} 
                 setApiSettings={(newSettings: any) => {
                   setApiSettings(newSettings);
                   if (newSettings.apiKey) {
                     localStorage.setItem('custom_gemini_key', newSettings.apiKey);
                   } else {
                     localStorage.removeItem('custom_gemini_key');
                   }
                   if (newSettings.model) {
                     localStorage.setItem('custom_gemini_model', newSettings.model);
                   }
                 }}
                 nightMode={nightMode} 
                 setNightMode={setNightMode}
                 handleLogout={() => signOut(auth)}
                 family={family}
                 updateFamily={(data: any) => {
                   if (profile?.familyId) {
                     updateDoc(doc(db, 'families', profile.familyId), data);
                   }
                 }}
                 onRepairSync={repairSync}
               />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Floating Action Bar - Slimmed */}
      <div className="fixed bottom-20 left-0 right-0 pointer-events-none px-4 pb-2 z-[60]">
        <div className="max-w-lg mx-auto pointer-events-auto space-y-3">
          {/* AI Feedback Overlay - Integrated */}
          <AnimatePresence>
            {aiFeedback && (
              <motion.div 
                initial={{ opacity: 0, y: 10, scale: 0.95 }} 
                animate={{ opacity: 1, y: 0, scale: 1 }} 
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className={cn(
                  "p-5 rounded-[32px] border shadow-2xl backdrop-blur-3xl relative overflow-hidden",
                  nightMode ? "bg-blue-600/90 border-blue-500 shadow-blue-900/40" : "bg-blue-600 border-blue-500 shadow-blue-200/50"
                )}
              >
                <div className="flex gap-3 text-white">
                  <div className="shrink-0 w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
                    <Baby size={18} />
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="text-[11px] font-medium leading-relaxed prose prose-invert max-w-none">
                      <ReactMarkdown>{aiFeedback.aiResponse}</ReactMarkdown>
                    </div>
                    {aiFeedback.safetyAlert && (
                      <div className="flex items-center gap-2 text-[8px] font-black uppercase tracking-widest bg-red-400/30 px-3 py-1.5 rounded-full w-fit border border-red-400/30">
                        <ShieldAlert size={10} className="text-red-200" />
                        {aiFeedback.safetyAlert.message}
                      </div>
                    )}
                    <button 
                      onClick={() => setAiFeedback(null)} 
                      className="text-[9px] font-black uppercase tracking-widest bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-full transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className={cn(
            "backdrop-blur-2xl border rounded-full p-1.5 flex items-center gap-2 shadow-2xl transition-colors",
            nightMode ? "bg-slate-900/95 border-slate-800 shadow-black/40" : "bg-white/95 border-gray-100 shadow-gray-200/50"
          )}>
            <button className="w-10 h-10 flex items-center justify-center text-gray-300 hover:text-blue-600 transition-colors">
              <Mic size={20} />
            </button>
            <input 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitLog()}
              placeholder="Quick log..." 
              className={cn(
                "flex-1 bg-transparent py-2.5 px-0.5 outline-none text-sm font-medium",
                nightMode ? "text-white placeholder-slate-600" : "text-gray-700 placeholder-gray-400"
              )}
            />
            <button 
              disabled={isProcessing || !input.trim()}
              onClick={() => submitLog()}
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center transition-all shadow-md",
                input.trim() ? "bg-blue-600 text-white shadow-blue-200" : (nightMode ? "bg-slate-800 text-slate-700" : "bg-gray-100 text-gray-300")
              )}
            >
              {isProcessing ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Navigation - Narrower */}
      <nav className={cn(
        "fixed bottom-0 left-0 right-0 border-t flex justify-around items-center px-1 pt-2 pb-6 z-50 transition-colors",
        nightMode ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
      )}>
        <NavButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<LayoutDashboard size={18} />} label="Home" nightMode={nightMode} />
        <NavButton active={activeTab === 'timeline'} onClick={() => setActiveTab('timeline')} icon={<Calendar size={18} />} label="Logs" nightMode={nightMode} />
        <div className="w-8" />
        <NavButton active={activeTab === 'insights'} onClick={() => setActiveTab('insights')} icon={<BarChart3 size={18} />} label="Trend" nightMode={nightMode} />
        <NavButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<UserIcon size={18} />} label="Profile" nightMode={nightMode} />
      </nav>

      {/* Emergency Mode Modal */}
      <AnimatePresence>
        {emergencyOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-6">
            <motion.div 
              initial={{ scale: 0.9, y: 20 }} 
              animate={{ scale: 1, y: 0 }} 
              exit={{ scale: 0.9, y: 20 }} 
              className="w-full max-w-sm bg-white rounded-[48px] p-8 space-y-8 shadow-2xl relative overflow-hidden"
            >
               <div className="absolute top-0 left-0 w-full h-2 bg-red-600" />
               <div className="flex items-center justify-between">
                 <div className="flex items-center gap-3">
                   <div className="w-10 h-10 bg-red-50 text-red-600 rounded-xl flex items-center justify-center animate-pulse">
                     <ShieldAlert size={24} />
                   </div>
                   <h2 className="text-2xl font-black text-red-600 tracking-tight">SOS Help</h2>
                 </div>
                 <button onClick={() => setEmergencyOpen(false)} className="w-10 h-10 bg-gray-100/50 hover:bg-gray-100 rounded-full flex items-center justify-center transition-colors">
                   <Plus className="rotate-45 text-gray-500" />
                 </button>
               </div>
               
               <div className="space-y-3">
                 <EmergencyItem title="Difficulty Breathing" guidance="Look for rib pulling or blue tint. Call 911 now." />
                 <EmergencyItem title="High Fever (>38°C)" guidance="Seek urgent pediatric advice immediately." />
                 <EmergencyItem title="Choking/Airway" guidance="Clear airway if trained. Call emergency services." />
               </div>

               <button className="w-full py-5 bg-red-600 text-white font-black rounded-[24px] flex items-center justify-center gap-3 shadow-2xl shadow-red-500/30 hover:scale-[1.02] active:scale-95 transition-all">
                 <Activity size={24} /> Call Pediatrician 
               </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EmergencyItem({ title, guidance }: { title: string, guidance: string }) {
  return (
    <div className="p-4 bg-red-50 border border-red-100 rounded-2xl">
      <h3 className="font-bold text-red-900">{title}</h3>
      <p className="text-sm text-red-600 leading-snug">{guidance}</p>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="h-screen bg-baby-bg flex items-center justify-center p-4 overflow-hidden">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-[320px] bg-white p-10 rounded-[48px] border border-gray-100 premium-shadow flex flex-col items-center text-center shadow-2xl relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 rounded-full blur-3xl -mr-8 -mt-8" />
        
        <motion.div 
          animate={{ scale: [1, 1.05, 1], rotate: [0, 5, -5, 0] }} 
          transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }} 
          className="w-20 h-20 bg-blue-600 rounded-[32px] flex items-center justify-center text-white shadow-xl shadow-blue-500/20 mb-8 relative z-10"
        >
          <Baby size={40} />
        </motion.div>
        
        <div className="space-y-4 relative z-10">
          <h2 className="text-2xl font-serif font-black text-gray-900 tracking-tight">Xavian Care AI</h2>
          <div className="flex flex-col items-center gap-3">
            <div className="flex gap-1.5">
              {[0, 1, 2].map(i => (
                <motion.span 
                  key={i}
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ repeat: Infinity, duration: 1.5, delay: i * 0.2 }}
                  className="w-2 h-2 bg-blue-600 rounded-full"
                />
              ))}
            </div>
            <p className="text-[8px] text-gray-400 uppercase tracking-[0.4em] font-black">Pulse-Check</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function AuthScreen({ handleLogin }: { handleLogin: () => void }) {
  return (
    <div className="h-screen bg-baby-bg flex items-center justify-center p-4 overflow-hidden">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-[340px] bg-white p-8 sm:p-10 rounded-[48px] border border-gray-100 premium-shadow flex flex-col items-center text-center shadow-2xl relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-32 h-32 bg-blue-50 rounded-full blur-3xl -ml-16 -mt-16 opacity-50" />
        
        <div className="relative inline-block mb-8 z-10">
          <motion.div 
            initial={{ rotate: -10, scale: 0.9 }}
            animate={{ rotate: 0, scale: 1 }}
            className="w-24 h-24 bg-blue-600 rounded-[40px] flex items-center justify-center text-white shadow-xl shadow-blue-500/20"
          >
            <Baby size={48} />
          </motion.div>
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5 }} className="absolute -top-2 -right-2 w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-lg border border-gray-50 text-blue-500">
            <Activity size={20} />
          </motion.div>
        </div>
        
        <div className="space-y-4 mb-10 z-10">
          <h1 className="text-4xl font-serif font-black tracking-tight text-gray-900 leading-tight">
            Baby Care, <br/>
            <span className="text-blue-600 italic">Redefined.</span>
          </h1>
          <p className="text-gray-400 max-w-[240px] mx-auto text-xs font-medium leading-relaxed">
            The mission-critical dashboard for Xavian's growth and health.
          </p>
        </div>

        <button 
          onClick={handleLogin} 
          className="w-full py-5 bg-gray-900 text-white rounded-[24px] font-black uppercase tracking-widest shadow-xl shadow-gray-400 flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-95 transition-all group z-10 text-[10px]"
        >
          <UserIcon size={16} /> Sync via Google
        </button>
      </motion.div>
    </div>
  );
}

const GoalCircle = ({ percentage, value, label, icon, color, nightMode }: any) => {
  const radius = 35;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className={cn(
      "flex flex-col items-center justify-center p-4 rounded-[40px] border transition-all",
      nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
    )}>
      <div className="relative w-24 h-24 flex items-center justify-center">
        <svg className="w-full h-full transform -rotate-90">
          <circle
            cx="48"
            cy="48"
            r={radius}
            stroke="currentColor"
            strokeWidth="8"
            fill="transparent"
            className={nightMode ? "text-slate-800" : "text-gray-50"}
          />
          <motion.circle
            cx="48"
            cy="48"
            r={radius}
            stroke="currentColor"
            strokeWidth="8"
            fill="transparent"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            className={color}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
          <div className={cn("mb-0.5", color)}>{icon}</div>
          <span className={cn("text-xs font-black tracking-tighter leading-none", nightMode ? "text-white" : "text-gray-900")}>
            {value}
          </span>
        </div>
      </div>
      <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mt-2">{label}</p>
    </div>
  );
};

function SummaryCard({ icon, label, value, color, total, nightMode }: any) {
  const getDisplayValue = () => {
    if (value === '---') return '--';
    try {
      // Ensure we have a valid date for distance format
      return value;
    } catch (e) {
      return '--';
    }
  };

  return (
    <div className={cn(
      "p-4 rounded-[28px] border relative overflow-hidden group transition-all duration-300",
      nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
    )}>
      <div className="flex items-center gap-3 mb-2">
        <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center shrink-0", color)}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 truncate">{label}</p>
          <p className={cn("text-lg font-black tracking-tighter truncate leading-none", nightMode ? "text-white" : "text-gray-900")}>
            {getDisplayValue()}
          </p>
        </div>
      </div>
      <div className={cn(
        "text-[9px] font-black px-2 py-1 rounded-lg w-fit",
        nightMode ? "bg-blue-500/10 text-blue-400" : "bg-blue-50 text-blue-600"
      )}>
        {total}
      </div>
    </div>
  );
}

function NavButton({ active, onClick, icon, label, nightMode }: any) {
  return (
    <button onClick={onClick} className={cn(
      "flex flex-col items-center gap-1 transition-all group", 
      active ? "text-blue-600" : "text-gray-300 hover:text-gray-400"
    )}>
      <div className={cn(
        "p-1.5 rounded-xl transition-all duration-300", 
        active ? (nightMode ? "bg-blue-500/20 scale-105" : "bg-blue-50 scale-105") : "group-hover:bg-gray-50"
      )}>
        {icon}
      </div>
      <span className={cn(
        "text-[8px] font-black uppercase tracking-widest",
        active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      )}>
        {label}
      </span>
    </button>
  );
}

function TimelineItem({ log, nightMode, onDelete }: { log: CareLog, nightMode?: boolean, onDelete?: (id: string) => void }) {
  const typeLower = log.type?.toLowerCase() || '';
  const isFeeding = typeLower === 'feeding' || typeLower === 'milk';
  const isSleep = typeLower === 'sleep' || typeLower === 'rest';
  const isDiaper = typeLower === 'diaper';
  const isMed = typeLower.startsWith('med') || typeLower === 'medication' || typeLower === 'health';

  const getSideLabel = () => {
    if (log.details?.side === 'left') return 'Left Side';
    if (log.details?.side === 'right') return 'Right Side';
    if (log.details?.side === 'both') return 'Both Sides';
    return null;
  };

  const getDiaperType = () => {
    const dType = log.details?.type?.toLowerCase() || '';
    if (dType === 'wet_dirty' || dType === 'both') return 'Wet & Dirty';
    if (dType === 'wet') return 'Wet Only';
    if (dType === 'dirty') return 'Dirty Only';
    return null;
  };

  return (
    <div className="relative z-10 pl-1.5 pr-2">
      <div className={cn(
        "p-5 rounded-[32px] border transition-all duration-500 hover:scale-[1.01] active:scale-[0.99]",
        nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow text-gray-900"
      )}>
        <div className="flex items-start gap-5">
          <div className={cn(
            "w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border relative",
            isFeeding ? "bg-orange-50 border-orange-100 text-orange-500 shadow-sm shadow-orange-100" : 
            isSleep ? "bg-indigo-50 border-indigo-100 text-indigo-500 shadow-sm shadow-indigo-100" : 
            isDiaper ? "bg-teal-50 border-teal-100 text-teal-500 shadow-sm shadow-teal-100" : 
            isMed ? "bg-red-50 border-red-100 text-red-500 shadow-sm shadow-red-100" :
            "bg-gray-50 border-gray-100 text-gray-400"
          )}>
            {isFeeding ? <Utensils size={18} /> : isSleep ? <Moon size={18} /> : isDiaper ? <Droplets size={18} /> : <Activity size={18} />}
            
            {/* Pulsing indicator for very recent logs */}
            {isToday((log.timestamp && typeof log.timestamp.toDate === 'function') ? log.timestamp.toDate() : new Date()) && (
              <span className="absolute -top-1 -right-1 flex h-2 w-2">
                <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", isFeeding ? "bg-orange-400" : isSleep ? "bg-indigo-400" : isDiaper ? "bg-teal-400" : "bg-red-400")}></span>
                <span className={cn("relative inline-flex rounded-full h-2 w-2", isFeeding ? "bg-orange-500" : isSleep ? "bg-indigo-500" : isDiaper ? "bg-teal-500" : "bg-red-500")}></span>
              </span>
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className={cn("font-black capitalize text-xs tracking-tight", nightMode ? "text-white" : "text-gray-900")}>
                  {log.type?.replace(/_/g, ' ')}
                </p>
                
                {isFeeding && log.details?.amount && (
                  <span className="bg-orange-500/10 text-orange-600 text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter">
                    {log.details.amount}ml
                  </span>
                )}
                
                {isFeeding && getSideLabel() && (
                  <span className="bg-gray-50 text-gray-400 text-[8px] font-black px-2 py-0.5 rounded-full uppercase">
                    {getSideLabel()}
                  </span>
                )}
                
                {isSleep && log.details?.duration && (
                  <span className="bg-indigo-500/10 text-indigo-600 text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter">
                    {log.details.duration}m Duration
                  </span>
                )}

                {isDiaper && getDiaperType() && (
                  <span className="bg-teal-500/10 text-teal-600 text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter">
                    {getDiaperType()}
                  </span>
                )}
                
                {isMed && log.details?.medicationName && (
                  <span className="bg-red-500/10 text-red-600 text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter">
                    {log.details.medicationName} {log.details.dosage ? `@ ${log.details.dosage}` : ''}
                  </span>
                )}
              </div>
              
              <button 
                onClick={() => onDelete?.(log.id!)}
                className="p-1.5 hover:bg-red-50 hover:text-red-500 rounded-xl text-gray-300 transition-all active:scale-90"
                title="Remove Entry"
              >
                <Trash2 size={14} />
              </button>
            </div>
            
            <p className={cn("text-[10px] font-semibold leading-relaxed mb-3", nightMode ? "text-slate-400" : "text-gray-500 italic")}>
              "{log.rawInput}"
            </p>
            
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50">
              <div className="flex items-center gap-1.5">
                 <div className="w-5 h-5 rounded-lg bg-blue-50 text-blue-500 flex items-center justify-center text-[9px] font-black">
                   {log.parentName?.charAt(0).toUpperCase() || 'P'}
                 </div>
                 <span className="text-[9px] font-black text-gray-400 uppercase tracking-tighter">{log.parentName || 'Parent'}</span>
              </div>
              <div className="flex items-center gap-1 text-gray-300">
                <Clock size={10} />
                <span className="text-[9px] font-black uppercase tracking-widest">
                  {(log.timestamp && typeof log.timestamp.toDate === 'function') ? format(log.timestamp.toDate(), 'h:mm a') : 'Recent'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChecklistItem({ label, checked, onClick, nightMode, icon: Icon }: any) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-2 p-4 rounded-[24px] border transition-all shrink-0 active:scale-95 group w-24 relative overflow-hidden",
        checked 
          ? (nightMode ? "bg-teal-500/20 border-teal-500/50 text-teal-400" : "bg-teal-50 border-teal-100 text-teal-700 shadow-sm shadow-teal-50") 
          : (nightMode ? "bg-slate-900 border-slate-800 text-gray-500" : "bg-white border-gray-100 text-gray-400 hover:border-gray-200")
      )}
    >
      <div className={cn(
        "w-10 h-10 rounded-2xl flex items-center justify-center transition-all duration-500",
        checked ? "bg-teal-500 text-white rotate-[360deg] scale-110" : (nightMode ? "bg-slate-800" : "bg-gray-50")
      )}>
        {Icon && <Icon size={20} />}
      </div>
      <span className="text-[8px] font-black uppercase tracking-[0.1em] text-center leading-tight">{label}</span>
      
      {/* Checkmark Badge */}
      <div className={cn(
        "absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center transition-all duration-300",
        checked ? "bg-teal-500 opacity-100 scale-100" : "bg-gray-200 opacity-0 scale-0"
      )}>
        <Plus size={10} className="text-white rotate-45" />
      </div>

      {/* Completion shine effect */}
      {checked && (
        <motion.div 
          initial={{ x: '-100%' }}
          animate={{ x: '100%' }}
          transition={{ duration: 1, repeat: Infinity, repeatDelay: 3 }}
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-12"
        />
      )}
    </button>
  );
}

function QuickActionButton({ icon, label, onClick, color, nightMode }: any) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-2 p-3 rounded-[24px] border transition-all active:scale-90 group h-full justify-center",
        nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
      )}
    >
      <div className={cn(
        "w-10 h-10 rounded-[18px] flex items-center justify-center transition-all duration-300 group-hover:scale-105",
        nightMode ? "bg-slate-800 text-blue-400" : color
      )}>
        {icon}
      </div>
      <span className={cn(
        "text-[8px] font-black uppercase tracking-widest",
        nightMode ? "text-slate-500 group-hover:text-white" : "text-gray-400 group-hover:text-gray-900"
      )}>
        {label}
      </span>
    </button>
  );
}

function SettingsView({ user, apiSettings, setApiSettings, nightMode, setNightMode, handleLogout, family, updateFamily, onRepairSync }: any) {
  return (
    <div className="space-y-4 pb-44">
      <div className="px-2 flex items-center justify-between">
        <h2 className={cn("text-[8px] font-black uppercase tracking-[0.3em]", nightMode ? "text-gray-600" : "text-gray-400")}>Identity & Config</h2>
        <button onClick={handleLogout} className="text-[8px] font-black text-red-500 uppercase tracking-widest flex items-center gap-1.5">
          <LogOut size={12} /> Exit Loop
        </button>
      </div>

      {/* Account Card - Condensed */}
      <div className={cn(
        "p-4 rounded-[28px] border flex items-center gap-4",
        nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
      )}>
        <img src={user.photoURL} alt="" className="w-10 h-10 rounded-2xl border border-white shadow-md" />
        <div className="flex-1">
          <h3 className={cn("text-base font-black tracking-tight leading-none", nightMode ? "text-white" : "text-gray-900")}>{user.displayName}</h3>
          <p className="text-[9px] text-gray-400 font-medium truncate max-w-[150px] mt-1">{user.email}</p>
        </div>
        <button 
          onClick={() => setNightMode((prev: boolean) => !prev)}
          className={cn(
            "w-10 h-10 rounded-2xl flex items-center justify-center transition-all",
            nightMode ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-500"
          )}
        >
          {nightMode ? <Moon size={18} /> : <Clock size={18} />}
        </button>
      </div>

      {/* Baby Details - NEW */}
      <div className={cn(
        "p-6 rounded-[32px] border space-y-4",
        nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
      )}>
        <h3 className={cn("text-[8px] font-black uppercase tracking-widest text-gray-400 px-1")}>Baby Profile</h3>
        <div className="space-y-3">
          <div className="space-y-2">
             <label className="text-[7px] font-black uppercase text-gray-400 px-1 tracking-tighter text-left block">Full Name</label>
             <input 
               type="text" 
               defaultValue={family?.babyName || 'Xavian Faris'}
               onBlur={(e) => updateFamily({ babyName: e.target.value })}
               className={cn("w-full px-4 py-3 rounded-2xl border text-xs font-black outline-none", nightMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-gray-50 border-gray-100 text-gray-900")}
             />
          </div>
          <div className="space-y-2">
             <label className="text-[7px] font-black uppercase text-gray-400 px-1 tracking-tighter text-left block">Birth Date</label>
             <input 
               type="date" 
               defaultValue={family?.birthDate || '2025-09-01'}
               onBlur={(e) => updateFamily({ birthDate: e.target.value })}
               className={cn("w-full px-4 py-3 rounded-2xl border text-xs font-black outline-none", nightMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-gray-50 border-gray-100 text-gray-900")}
             />
          </div>
        </div>
      </div>

      {/* Growth Record - NEW */}
      <div className={cn(
        "p-6 rounded-[32px] border space-y-4",
        nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
      )}>
        <div className="flex items-center justify-between">
          <h3 className={cn("text-[8px] font-black uppercase tracking-widest text-gray-400 px-1")}>Biometric Sync</h3>
          <button 
            onClick={onRepairSync}
            className="text-[8px] font-black text-blue-500 uppercase tracking-widest bg-blue-50 px-3 py-1 rounded-full"
          >
            Clean Sync
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
             <label className="text-[7px] font-black uppercase text-gray-400 px-1 tracking-tighter text-left block">Weight (kg)</label>
             <input 
               type="text" 
               defaultValue={family?.weight || '3.4'}
               onBlur={(e) => updateFamily({ weight: e.target.value })}
               className={cn("w-full px-4 py-3 rounded-2xl border text-xs font-black outline-none", nightMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-gray-50 border-gray-100 text-gray-900")}
             />
          </div>
          <div className="space-y-2">
             <label className="text-[7px] font-black uppercase text-gray-400 px-1 tracking-tighter text-left block">Height (cm)</label>
             <input 
               type="text" 
               defaultValue={family?.height || '51'}
               onBlur={(e) => updateFamily({ height: e.target.value })}
               className={cn("w-full px-4 py-3 rounded-2xl border text-xs font-black outline-none", nightMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-gray-50 border-gray-100 text-gray-900")}
             />
          </div>
        </div>
      </div>

      {/* Family Hub - NEW */}
      <div className={cn(
        "p-6 rounded-[32px] border space-y-4",
        nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
      )}>
         <h3 className={cn("text-[8px] font-black uppercase tracking-widest text-gray-400 px-1")}>Family Sharing</h3>
         <div className={cn("p-4 rounded-xl border border-dashed flex flex-col gap-2", nightMode ? "bg-slate-900/40 border-slate-700" : "bg-gray-50 border-gray-200")}>
            <p className="text-[7px] font-black uppercase text-gray-400 tracking-tighter text-left">Your Family Hub ID</p>
            <div className="flex items-center justify-between">
              <code className={cn("text-[10px] font-mono font-bold", nightMode ? "text-blue-400" : "text-blue-600")}>{family?.id || 'xavian-family-1'}</code>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(family?.id || 'xavian-family-1');
                  alert("Copied to clipboard!");
                }}
                className="text-[8px] font-black text-blue-500 uppercase"
              >
                Copy
              </button>
            </div>
         </div>
      </div>

      {/* AI Config - Condensed */}
      <div className={cn(
        "p-6 rounded-[32px] border space-y-4",
        nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
      )}>
        <div className="space-y-2">
          <label className="text-[8px] font-black uppercase tracking-widest text-gray-400 px-1">Gemini Key</label>
          <div className={cn(
            "flex items-center gap-2 px-4 py-3 rounded-2xl border transition-all",
            nightMode ? "bg-slate-900/50 border-slate-800" : "bg-gray-50 border-gray-100"
          )}>
            <ShieldAlert size={14} className="text-gray-300" />
            <input 
              type="password"
              placeholder="API Key..."
              value={apiSettings.apiKey}
              onChange={(e) => setApiSettings({ ...apiSettings, apiKey: e.target.value })}
              className="flex-1 bg-transparent outline-none text-xs font-medium placeholder-gray-400"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[8px] font-black uppercase tracking-widest text-gray-400 px-1">Model Layer</label>
          <div className={cn(
            "flex items-center gap-2 px-4 py-3 rounded-2xl border transition-all",
            nightMode ? "bg-slate-900/50 border-slate-800" : "bg-gray-50 border-gray-100"
          )}>
            <Activity size={14} className="text-gray-300" />
            <select 
              value={apiSettings.model}
              onChange={(e) => setApiSettings({ ...apiSettings, model: e.target.value })}
              className="flex-1 bg-transparent outline-none text-[11px] font-black tracking-tight"
            >
              <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
              <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
            </select>
          </div>
        </div>
      </div>

      <div className={cn(
        "p-4 rounded-[24px] border text-center flex flex-col items-center gap-2",
        nightMode ? "bg-blue-900/10 border-blue-900/20" : "bg-blue-50/50 border-blue-100"
      )}>
        <p className="text-[10px] text-gray-500 font-medium leading-tight">
          By default, you are using a shared preview limit. For <strong className={nightMode ? "text-blue-400" : "text-blue-600"}>Completely Free & Unlimited</strong> usage, paste your own key above. 
        </p>
        <a 
          href="https://aistudio.google.com/app/apikey" 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-[10px] font-black uppercase tracking-widest text-white bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded-full transition-all"
        >
          Get Free Key
        </a>
      </div>
    </div>
  );
}
function DashboardView({ 
  family, 
  logs, 
  totalMilk, 
  totalSleepMinutes, 
  totalDiapers, 
  aiFeedback, 
  nightMode, 
  onQuickLog, 
  setActiveTab,
  setAiFeedback,
  babyAge,
  weather,
  toggleChecklist,
  onDeleteLog
}: any) {
  const lastFeedingLog = logs.find((l: any) => l.type?.toLowerCase() === 'feeding' || l.type?.toLowerCase() === 'milk');
  const lastSleepLog = logs.find((l: any) => l.type?.toLowerCase() === 'sleep' || l.type?.toLowerCase() === 'rest');

  const formatExactTime = (timestamp: any) => {
    if (!timestamp) return '---';
    const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date();
    return format(date, 'h:mm a');
  };

  return (
    <div className="space-y-3 pb-44">
      {/* Baby Status & Growth Snapshot */}
      <div className={cn(
        "p-4 rounded-[32px] border transition-all relative overflow-hidden",
        nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
      )}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-inner",
              nightMode ? "bg-blue-900/40 text-blue-400" : "bg-blue-50 text-blue-600"
            )}>
              <Baby size={22} />
            </div>
            <div>
              <h2 className={cn("text-lg font-serif font-black tracking-tight leading-none", nightMode ? "text-white" : "text-gray-900")}>
                {family?.babyName || 'Xavian'}
              </h2>
              <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mt-1">{babyAge} • Newborn</p>
            </div>
          </div>
          <div className="flex flex-col items-end">
            {weather && (
              <div className="text-right mb-1">
                <p className={cn("text-xl font-black tracking-tighter", nightMode ? "text-white" : "text-gray-900")}>{weather.temp}°</p>
                <p className="text-[7px] text-gray-400 font-black uppercase tracking-widest">{weather.condition}</p>
              </div>
            )}
            <div className={cn(
              "px-2 py-0.5 rounded-full flex items-center gap-1.5 border",
              logs.length > 0 ? "bg-green-500/10 border-green-500/20 text-green-600" : "bg-orange-500/10 border-orange-500/20 text-orange-600"
            )}>
              <span className={cn("w-1 h-1 rounded-full animate-pulse", logs.length > 0 ? "bg-green-500" : "bg-orange-500")} />
              <span className="text-[8px] font-black uppercase tracking-tighter">{logs.length} Pulses</span>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
           <div className={cn("px-3 py-1.5 rounded-full flex items-center gap-2", nightMode ? "bg-slate-800" : "bg-gray-50")}>
              <Activity size={10} className="text-blue-500" />
              <span className={cn("text-[9px] font-black tracking-tighter", nightMode ? "text-gray-400" : "text-gray-600")}>{family?.weight || '3.4'}kg</span>
           </div>
           <div className={cn("px-3 py-1.5 rounded-full flex items-center gap-2", nightMode ? "bg-slate-800" : "bg-gray-50")}>
              <Plus size={10} className="text-teal-500" />
              <span className={cn("text-[9px] font-black tracking-tighter", nightMode ? "text-gray-400" : "text-gray-600")}>{family?.height || '51'}cm</span>
           </div>
        </div>
      </div>

      {/* Daily Target Pulses - NEW Goal Circles */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-3">
          <GoalCircle 
            percentage={Math.min((totalMilk / 800) * 100, 100)}
            value={`${totalMilk}ml`}
            label="Daily Volume"
            icon={<Utensils size={14} />}
            color="text-orange-500"
            nightMode={nightMode}
          />
          <div className={cn(
            "px-4 py-2 rounded-2xl border text-center",
            nightMode ? "bg-slate-800/50 border-slate-700" : "bg-gray-50 border-gray-100"
          )}>
            <p className="text-[7px] font-black uppercase text-gray-400">Last Feed</p>
            <p className={cn("text-[9px] font-bold truncate", nightMode ? "text-white" : "text-gray-700")}>
              {lastFeedingLog ? formatExactTime(lastFeedingLog.timestamp) : '---'}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <GoalCircle 
            percentage={Math.min((totalSleepMinutes / 900) * 100, 100)}
            value={`${(totalSleepMinutes / 60).toFixed(1)}h`}
            label="Daily Rest"
            icon={<Moon size={14} />}
            color="text-indigo-500"
            nightMode={nightMode}
          />
          <div className={cn(
            "px-4 py-2 rounded-2xl border text-center",
            nightMode ? "bg-slate-800/50 border-slate-700" : "bg-gray-50 border-gray-100"
          )}>
            <p className="text-[7px] font-black uppercase text-gray-400">Last Nap</p>
            <p className={cn("text-[9px] font-bold truncate", nightMode ? "text-white" : "text-gray-700")}>
              {lastSleepLog ? formatExactTime(lastSleepLog.timestamp) : '---'}
            </p>
          </div>
        </div>
      </div>

      {/* Event Logger - Compact Grid */}
      <div className="grid grid-cols-4 gap-2">
        <QuickActionButton icon={<Utensils size={18} />} label="Milk" onClick={() => onQuickLog('feeding')} color="text-orange-600 bg-orange-50" nightMode={nightMode} />
        <QuickActionButton icon={<Moon size={18} />} label="Sleep" onClick={() => onQuickLog('sleep')} color="text-indigo-600 bg-indigo-50" nightMode={nightMode} />
        <QuickActionButton icon={<Droplets size={18} />} label="Diaper" onClick={() => onQuickLog('diaper')} color="text-teal-600 bg-teal-50" nightMode={nightMode} />
        <QuickActionButton icon={<Activity size={18} />} label="Clinic" onClick={() => onQuickLog('health')} color="text-red-600 bg-red-50" nightMode={nightMode} />
      </div>

      {/* Nursing Hub - Side Selector - NEW */}
      <div className={cn(
        "p-4 rounded-[32px] border space-y-3",
        nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
      )}>
         <div className="flex items-center justify-between px-1">
            <h3 className={cn("text-[8px] font-black uppercase tracking-widest", nightMode ? "text-gray-600" : "text-gray-400")}>Nursing Hub</h3>
            <div className="flex gap-1.5">
               <button onClick={() => onQuickLog('feeding_left')} className="text-[7px] font-black uppercase bg-orange-50 text-orange-600 px-3 py-1 rounded-full border border-orange-100">Left</button>
               <button onClick={() => onQuickLog('feeding_right')} className="text-[7px] font-black uppercase bg-orange-50 text-orange-600 px-3 py-1 rounded-full border border-orange-100">Right</button>
               <button onClick={() => onQuickLog('feeding_both')} className="text-[7px] font-black uppercase bg-orange-50 text-orange-600 px-3 py-1 rounded-full border border-orange-100">Both</button>
            </div>
         </div>
      </div>

      {/* Predictive Intelligence Grid - New Feature */}
      <div className="grid grid-cols-2 gap-3">
         <div className={cn(
           "p-4 rounded-[28px] border flex items-center gap-3 transition-all", 
           nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
         )}>
            <div className={cn(
              "w-8 h-8 rounded-xl flex items-center justify-center shrink-0",
              nightMode ? "bg-blue-500/10 text-blue-400" : "bg-blue-50 text-blue-500"
            )}>
              <Clock size={16} />
            </div>
            <div>
              <p className="text-[7px] font-black uppercase text-gray-400 tracking-tighter">Next Feed</p>
              <p className={cn("text-xs font-black tracking-tight", nightMode ? "text-white" : "text-gray-900")}>~ Within 45m</p>
            </div>
         </div>
         <div className={cn(
           "p-4 rounded-[28px] border flex items-center gap-3 transition-all", 
           nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
         )}>
            <div className={cn(
              "w-8 h-8 rounded-xl flex items-center justify-center shrink-0",
              nightMode ? "bg-teal-500/10 text-teal-400" : "bg-teal-50 text-teal-500"
            )}>
              <Activity size={16} />
            </div>
            <div>
              <p className="text-[7px] font-black uppercase text-gray-400 tracking-tighter">Wardrobe</p>
              <p className={cn("text-xs font-black tracking-tight", nightMode ? "text-white" : "text-gray-900")}>1.0 TOG Sack</p>
            </div>
         </div>
      </div>

      {/* Care Checklist - Essential Feature */}
      <div className={cn(
         "p-5 rounded-[32px] border space-y-4",
         nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
      )}>
         <div className="flex items-center justify-between px-1">
            <div>
              <h3 className={cn("text-[8px] font-black uppercase tracking-widest", nightMode ? "text-gray-600" : "text-gray-400")}>Daily Mission</h3>
              <div className="flex items-center gap-1.5 mt-1">
                <div className="h-1 w-20 bg-gray-100 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ 
                      width: `${(Object.values(family?.dailyChecklist || {}).filter(Boolean).length / 3) * 100}%` 
                    }}
                    className="h-full bg-teal-500"
                  />
                </div>
                <span className="text-[7px] font-black text-teal-500 uppercase">
                  {Math.round((Object.values(family?.dailyChecklist || {}).filter(Boolean).length / 3) * 100)}%
                </span>
              </div>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[8px] font-black text-teal-500 uppercase tracking-widest italic">Live Feed</span>
              <p className="text-[6px] text-gray-400 font-black uppercase mt-0.5">Focus: Routine Consistency</p>
            </div>
         </div>
         <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
            <ChecklistItem 
              label="Vitamins" 
              icon={Activity}
              checked={family?.dailyChecklist?.vitamins} 
              onClick={() => toggleChecklist('vitamins')} 
              nightMode={nightMode} 
            />
            <ChecklistItem 
              label="Tummy Time" 
              icon={Baby}
              checked={family?.dailyChecklist?.tummyTime} 
              onClick={() => toggleChecklist('tummyTime')} 
              nightMode={nightMode} 
            />
            <ChecklistItem 
              label="Bath" 
              icon={Droplets}
              checked={family?.dailyChecklist?.bath} 
              onClick={() => toggleChecklist('bath')} 
              nightMode={nightMode} 
            />
         </div>
      </div>

      {/* Pediatric Pharmacy - NEW */}
      <div className={cn(
        "p-4 rounded-[32px] border space-y-3",
        nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
      )}>
         <div className="flex items-center justify-between px-1">
            <h3 className={cn("text-[8px] font-black uppercase tracking-widest", nightMode ? "text-gray-600" : "text-gray-400")}>Clinic Loop</h3>
            <Activity size={12} className="text-red-500" />
         </div>
         <div className="grid grid-cols-3 gap-2">
            <button onClick={() => onQuickLog('med_vitamin')} className={cn("p-2 rounded-2xl border text-center transition-all", nightMode ? "bg-slate-800/40 border-slate-700" : "bg-gray-50 border-gray-100")}>
               <p className="text-[9px] font-black uppercase text-blue-500">Vitamins</p>
               <p className="text-[6px] text-gray-400 uppercase mt-0.5">Daily Dose</p>
            </button>
            <button onClick={() => onQuickLog('med_tylenol')} className={cn("p-2 rounded-2xl border text-center transition-all", nightMode ? "bg-slate-800/40 border-slate-700" : "bg-gray-50 border-gray-100")}>
               <p className="text-[9px] font-black uppercase text-red-500">Tylenol</p>
               <p className="text-[6px] text-gray-400 uppercase mt-0.5">As Needed</p>
            </button>
            <button onClick={() => onQuickLog('med_gas')} className={cn("p-2 rounded-2xl border text-center transition-all", nightMode ? "bg-slate-800/40 border-slate-700" : "bg-gray-50 border-gray-100")}>
               <p className="text-[9px] font-black uppercase text-teal-500">Gas Drops</p>
               <p className="text-[6px] text-gray-400 uppercase mt-0.5">Comfort</p>
            </button>
         </div>
      </div>
        {/* Soothing Secrets - NEW */}
      <div className={cn(
        "p-5 rounded-[40px] border transition-all flex items-center justify-between", 
        nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
      )}>
         <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
               <Moon size={16} />
            </div>
            <div>
               <p className="text-[10px] font-black uppercase tracking-tight">Soothing Mode</p>
               <p className="text-[7px] text-gray-400 font-black uppercase tracking-widest leading-none mt-1">AI 5S Techniques Active</p>
            </div>
         </div>
         <button onClick={() => onQuickLog("soothe")} className="text-[9px] font-black text-blue-500 uppercase px-4 py-2 bg-blue-50 rounded-full">Help Me</button>
      </div>

      <div className="flex items-center justify-between mb-3 px-1">
          <h2 className={cn("text-[8px] font-black uppercase tracking-[0.3em]", nightMode ? "text-gray-600" : "text-gray-400")}>Recent Pulse</h2>
          <button onClick={() => setActiveTab('timeline')} className="text-[8px] font-black text-blue-500 uppercase">Archive</button>
        </div>
        <div className="space-y-2">
          {logs.slice(0, 2).map((log: CareLog) => (
            <TimelineItem key={log.id} log={log} nightMode={nightMode} onDelete={onDeleteLog} />
          ))}
        </div>
      </div>
    );
  }
  
  function TrendsView({ feedingData, sleepData, logs, nightMode, family, toggleVaccine, avgFeedingAmount, avgFeedingGap, avgSleepDuration, recentMedications }: any) {
  const VACCINE_LIST = [
    { key: 'hepB_birth', label: 'HepB (Birth)', weeks: 0 },
    { key: 'rotavirus_2m', label: 'Rotavirus (2m)', weeks: 8 },
    { key: 'dtap_2m', label: 'DTaP (2m)', weeks: 8 },
    { key: 'hib_2m', label: 'Hib (2m)', weeks: 8 },
    { key: 'pcv_2m', label: 'PCV (2m)', weeks: 8 },
    { key: 'ipv_2m', label: 'IPV/Polio (2m)', weeks: 8 },
  ];

  return (
    <div className="space-y-4 pb-44">
      {/* Clinician's Overview Header */}
      <div className={cn(
        "p-6 rounded-[32px] border flex items-center justify-between",
        nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
      )}>
        <div>
          <h2 className={cn("text-lg font-serif font-black tracking-tight", nightMode ? "text-white" : "text-gray-900")}>Clinical Report</h2>
          <p className="text-[8px] font-black uppercase tracking-widest text-blue-500 mt-1">Status: Stable Performance</p>
        </div>
        <div className="text-right">
          <p className="text-[7px] font-black uppercase text-gray-400 tracking-widest">Growth</p>
          <p className={cn("text-xs font-black", nightMode ? "text-white" : "text-gray-900")}>{family?.weight}kg • {family?.height}cm</p>
        </div>
      </div>

      {/* Vital Nutrients Analytics */}
      <div className={cn(
        "p-5 rounded-[40px] border transition-all relative overflow-hidden", 
        nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
      )}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-8 h-8 rounded-xl flex items-center justify-center",
              nightMode ? "bg-orange-500/10 text-orange-400" : "bg-orange-50 text-orange-500"
            )}>
              <Utensils size={14} />
            </div>
            <p className={cn("font-serif font-black text-sm tracking-tight", nightMode ? "text-white" : "text-gray-900")}>Nutritional Pulse</p>
          </div>
          <span className="text-[7px] text-gray-400 font-black uppercase tracking-widest bg-gray-50 px-2 py-0.5 rounded-full">10-Cycle Data</span>
        </div>

        <div className="h-[140px] w-full translate-x-[-15px]">
           <ResponsiveContainer width="112%" height="100%">
              <AreaChart data={feedingData}>
                <defs>
                  <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={nightMode ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)"} />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{fontSize: 7, fontWeight: 900}} />
                <YAxis hide domain={[0, 'dataMax + 40']} />
                <Tooltip 
                  contentStyle={{ 
                    borderRadius: '12px', 
                    border: 'none', 
                    fontSize: '9px',
                    fontWeight: 900,
                    padding: '8px 12px',
                    backgroundColor: nightMode ? '#1e293b' : '#fff',
                    boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)'
                  }} 
                />
                {avgFeedingAmount > 0 && (
                  <ReferenceLine 
                    y={avgFeedingAmount} 
                    stroke="#f97316" 
                    strokeDasharray="3 3" 
                    label={{ 
                      value: `AVG: ${avgFeedingAmount}ml`, 
                      position: 'right', 
                      fill: '#f97316', 
                      fontSize: 7, 
                      fontWeight: 900 
                    }} 
                  />
                )}
                <Area 
                  type="monotone" 
                  dataKey="amount" 
                  stroke="#f97316" 
                  strokeWidth={3} 
                  fillOpacity={1} 
                  fill="url(#colorAmount)" 
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              </AreaChart>
           </ResponsiveContainer>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
           <div className={cn("p-3 rounded-2xl flex flex-col items-center", nightMode ? "bg-slate-800/50" : "bg-gray-50")}>
              <p className="text-[7px] font-black uppercase text-gray-400 tracking-tighter">Avg Vol</p>
              <p className={cn("text-xs font-black", nightMode ? "text-orange-400" : "text-orange-600")}>{avgFeedingAmount}ml</p>
           </div>
           <div className={cn("p-3 rounded-2xl flex flex-col items-center", nightMode ? "bg-slate-800/50" : "bg-gray-50")}>
              <p className="text-[7px] font-black uppercase text-gray-400 tracking-tighter">Mean Gap</p>
              <p className={cn("text-xs font-black", nightMode ? "text-indigo-400" : "text-indigo-600")}>{avgFeedingGap}h</p>
           </div>
           <div className={cn("p-3 rounded-2xl flex flex-col items-center", nightMode ? "bg-slate-800/50" : "bg-gray-50")}>
              <p className="text-[7px] font-black uppercase text-gray-400 tracking-tighter">Hydration</p>
              <p className={cn("text-xs font-black", nightMode ? "text-teal-400" : "text-teal-600")}>Optimal</p>
           </div>
        </div>
      </div>

      {/* Vital Nutrients Analytics */}
      <div className={cn(
        "p-5 rounded-[40px] border transition-all relative overflow-hidden", 
        nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
      )}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-8 h-8 rounded-xl flex items-center justify-center",
              nightMode ? "bg-indigo-500/10 text-indigo-400" : "bg-indigo-50 text-indigo-500"
            )}>
              <Moon size={14} />
            </div>
            <p className={cn("font-serif font-black text-sm tracking-tight", nightMode ? "text-white" : "text-gray-900")}>Sleep Architecture</p>
          </div>
          <span className="text-[7px] text-gray-400 font-black uppercase tracking-widest bg-gray-50 px-2 py-0.5 rounded-full">Last 10 Rests</span>
        </div>

        <div className="h-[140px] w-full translate-x-[-15px]">
           <ResponsiveContainer width="112%" height="100%">
              <AreaChart data={sleepData}>
                <defs>
                  <linearGradient id="colorSleep" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={nightMode ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)"} />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{fontSize: 7, fontWeight: 900}} />
                <YAxis hide domain={[0, 'dataMax + 60']} />
                <Tooltip 
                  contentStyle={{ 
                    borderRadius: '12px', 
                    border: 'none', 
                    fontSize: '9px',
                    fontWeight: 900,
                    padding: '8px 12px',
                    backgroundColor: nightMode ? '#1e293b' : '#fff',
                    boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)'
                  }} 
                />
                {avgSleepDuration > 0 && (
                  <ReferenceLine 
                    y={avgSleepDuration} 
                    stroke="#6366f1" 
                    strokeDasharray="3 3" 
                    label={{ 
                      value: `AVG: ${avgSleepDuration}m`, 
                      position: 'right', 
                      fill: '#6366f1', 
                      fontSize: 7, 
                      fontWeight: 900 
                    }} 
                  />
                )}
                <Area 
                  type="monotone" 
                  dataKey="duration" 
                  stroke="#6366f1" 
                  strokeWidth={3} 
                  fillOpacity={1} 
                  fill="url(#colorSleep)" 
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              </AreaChart>
           </ResponsiveContainer>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
           <div className={cn("p-3 rounded-2xl flex flex-col items-center", nightMode ? "bg-slate-800/50" : "bg-gray-50")}>
              <p className="text-[7px] font-black uppercase text-gray-400 tracking-tighter">Avg Rest</p>
              <p className={cn("text-xs font-black", nightMode ? "text-indigo-400" : "text-indigo-600")}>{avgSleepDuration}m</p>
           </div>
           <div className={cn("p-3 rounded-2xl flex flex-col items-center", nightMode ? "bg-slate-800/50" : "bg-gray-50")}>
              <p className="text-[7px] font-black uppercase text-gray-400 tracking-tighter">Consistency</p>
              <p className={cn("text-xs font-black", nightMode ? "text-teal-400" : "text-teal-600")}>High Efficiency</p>
           </div>
        </div>
      </div>

      {/* Medication & Clinical History */}
      <div className={cn(
        "p-6 rounded-[32px] border space-y-4",
        nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
      )}>
        <div className="flex items-center justify-between px-1">
          <h3 className={cn("text-[8px] font-black uppercase tracking-widest text-gray-400")}>Pharma & Clinical History</h3>
          <ShieldAlert size={12} className="text-red-500" />
        </div>
        <div className="space-y-3">
          {recentMedications.map((m: any) => (
            <div key={m.id} className={cn("p-3 rounded-2xl border flex items-center justify-between", nightMode ? "bg-slate-900 border-slate-800" : "bg-gray-50 border-gray-100")}>
              <div>
                <p className={cn("text-[10px] font-black uppercase", nightMode ? "text-white" : "text-gray-900")}>
                  {m.details?.medicationName || m.type}
                </p>
                <p className="text-[8px] font-black text-gray-400 uppercase tracking-tighter">
                  {m.details?.dosage || 'Check record'} • {(m.timestamp && typeof m.timestamp.toDate === 'function') ? format(m.timestamp.toDate(), 'MMM d, p') : 'Syncing'}
                </p>
              </div>
              <div className="bg-red-50 text-red-500 text-[8px] font-black px-2 py-1 rounded-lg uppercase">Clinical Log</div>
            </div>
          ))}
          {recentMedications.length === 0 && (
            <p className="text-center text-[10px] text-gray-400 font-bold italic py-4">No recent medication events...</p>
          )}
        </div>
      </div>

      {/* Vaccine Hub - NEW */}
      <div className={cn(
        "p-6 rounded-[40px] border transition-all", 
        nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
      )}>
         <div className="flex items-center justify-between mb-4 px-1">
            <h3 className={cn("text-[8px] font-black uppercase tracking-widest", nightMode ? "text-gray-600" : "text-gray-400")}>Clinic Roadmap</h3>
            <span className="text-[8px] font-black text-blue-500 uppercase">Immunization</span>
         </div>
         <div className="space-y-2">
            {VACCINE_LIST.map(v => (
              <button 
                key={v.key}
                onClick={() => toggleVaccine(v.key)}
                className={cn(
                  "w-full flex items-center justify-between p-4 rounded-2xl border transition-all",
                  family?.vaccines?.[v.key] 
                    ? (nightMode ? "bg-teal-500/10 border-teal-500/30 text-teal-400" : "bg-teal-50 border-teal-100 text-teal-700")
                    : (nightMode ? "bg-slate-800/40 border-slate-700 text-gray-500" : "bg-gray-50 border-gray-100 text-gray-400")
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                    family?.vaccines?.[v.key] ? "bg-teal-500 border-teal-500" : "border-gray-300"
                  )}>
                    {family?.vaccines?.[v.key] && <Plus size={12} className="text-white rotate-45" />}
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-tight">{v.label}</span>
                </div>
                <span className="text-[8px] font-bold opacity-50 uppercase">{v.weeks}w Threshold</span>
              </button>
            ))}
         </div>
      </div>

      {/* Health Loop Details */}
      <div className={cn(
        "p-6 rounded-[40px] border transition-all", 
        nightMode ? "bg-night-surface border-slate-800" : "bg-white border-gray-100 premium-shadow"
      )}>
        <div className="flex items-center justify-between mb-4">
           <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Bio-Verified Metrics</p>
           <Activity size={12} className="text-teal-500" />
        </div>
        
        <div className="space-y-4">
           <div>
              <div className="flex justify-between items-end mb-1">
                 <p className={cn("text-[10px] font-black uppercase tracking-tight", nightMode ? "text-white" : "text-gray-900")}>Sleep Quota</p>
                 <p className="text-sm font-black text-indigo-500 tracking-tighter">82%</p>
              </div>
              <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                 <div className="h-full bg-indigo-500 rounded-full w-[82%]" />
              </div>
           </div>

           <div>
              <div className="flex justify-between items-end mb-1">
                 <p className={cn("text-[10px] font-black uppercase tracking-tight", nightMode ? "text-white" : "text-gray-900")}>Growth Wave</p>
                 <p className="text-sm font-black text-teal-500 tracking-tighter">94%</p>
              </div>
              <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                 <div className="h-full bg-teal-500 rounded-full w-[94%]" />
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}

function TimelineView({ logs, nightMode, onDeleteLog }: any) {
  const [filter, setFilter] = useState<'all' | 'feeding' | 'sleep' | 'diaper' | 'meds'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  const filteredLogs = logs.filter((log: any) => {
    // Type Filter
    const type = log.type?.toLowerCase() || '';
    const matchesFilter = filter === 'all' || 
                         (filter === 'meds' && (type.startsWith('med') || type === 'health')) ||
                         (type === filter || (filter === 'feeding' && type === 'milk') || (filter === 'sleep' && type === 'rest'));
    
    // Search Filter
    const matchesSearch = !searchQuery || 
                          log.rawInput?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          log.parentName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          log.type?.toLowerCase().includes(searchQuery.toLowerCase());
                          
    return matchesFilter && matchesSearch;
  });

  // Grouping logic
  const groupedLogs: Record<string, any[]> = {};
  filteredLogs.forEach((log: any) => {
    const date = (log.timestamp && typeof log.timestamp.toDate === 'function') ? log.timestamp.toDate() : new Date();
    let dateKey = format(date, 'yyyy-MM-dd');
    if (isToday(date)) dateKey = 'Today';
    else if (isYesterday(date)) dateKey = 'Yesterday';
    else dateKey = format(date, 'MMMM do');

    if (!groupedLogs[dateKey]) groupedLogs[dateKey] = [];
    groupedLogs[dateKey].push(log);
  });

  const FilterTab = ({ id, label, icon }: { id: typeof filter, label: string, icon: any }) => (
    <button 
      onClick={() => setFilter(id)}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-full border transition-all text-[9px] font-black uppercase tracking-widest whitespace-nowrap",
        filter === id 
          ? (nightMode ? "bg-blue-600 border-blue-500 text-white" : "bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200") 
          : (nightMode ? "bg-slate-900 border-slate-800 text-gray-500" : "bg-white border-gray-100 text-gray-400 hover:border-gray-200")
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="space-y-6 pb-44">
      <div className="px-2 space-y-4">
        <div className="flex items-center justify-between">
           <h2 className={cn("text-[8px] font-black uppercase tracking-[0.3em]", nightMode ? "text-gray-600" : "text-gray-400")}>Archive Hub</h2>
           <span className="text-[10px] font-black text-blue-500">{filteredLogs.length} Events</span>
        </div>
        
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
          <FilterTab id="all" label="All" icon={<Filter size={10} />} />
          <FilterTab id="feeding" label="Feeding" icon={<Utensils size={10} />} />
          <FilterTab id="sleep" label="Sleep" icon={<Moon size={10} />} />
          <FilterTab id="diaper" label="Diapers" icon={<Droplets size={10} />} />
          <FilterTab id="meds" label="Clinic" icon={<Activity size={10} />} />
        </div>

        {/* New Search Interface */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
          <input 
            type="text"
            placeholder="Search events, notes, or parents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              "w-full pl-10 pr-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border",
              nightMode 
                ? "bg-slate-900 border-slate-800 text-white focus:border-blue-500" 
                : "bg-gray-50 border-gray-100 text-gray-900 focus:bg-white focus:border-blue-200 focus:shadow-lg focus:shadow-blue-50/50"
            )}
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 bg-gray-100 rounded-full flex items-center justify-center text-gray-400"
            >
              <Plus size={10} className="rotate-45" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-8">
        {Object.entries(groupedLogs).map(([date, items]) => (
          <div key={date} className="space-y-4">
             <div className="flex items-center gap-4 px-2">
                <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-gray-100 to-transparent" />
                <p className={cn("text-[9px] font-black uppercase tracking-[0.2em]", nightMode ? "text-slate-700" : "text-gray-300")}>{date}</p>
                <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-gray-100 to-transparent" />
             </div>
             <div className="space-y-6 relative">
                {/* Chronology Line */}
                <div className={cn(
                  "absolute left-6 top-2 bottom-2 w-0.5 z-0",
                  nightMode ? "bg-slate-800/50" : "bg-gray-100/50"
                )} />

                {items.map((log: any) => (
                  <TimelineItem key={log.id} log={log} nightMode={nightMode} onDelete={onDeleteLog} />
                ))}
             </div>
          </div>
        ))}

        {filteredLogs.length === 0 && (
          <div className={cn(
            "text-center py-20 rounded-[40px] border-2 border-dashed mx-2",
            nightMode ? "bg-slate-900 border-slate-800" : "bg-white border-gray-100"
          )}>
             <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Calendar size={28} className="text-gray-200" />
             </div>
             <p className="text-[11px] text-gray-400 font-black uppercase tracking-widest">No matching activities</p>
             <p className="text-[9px] text-gray-300 mt-2">The loop is currently silent in this view.</p>
          </div>
        )}
      </div>
    </div>
  );
}

