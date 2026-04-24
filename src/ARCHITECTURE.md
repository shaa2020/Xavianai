# Xavian Care AI: App Architecture

## 1. Modules & Features

### Core Tracking Module
- **Feeding**: Handles breast (side/duration) and bottle (amount/type).
- **Sleep**: Tracks nap/night cycles, quality, and crib/bassinet locations.
- **Diapers**: Monitors frequency and color for hydration/health signals.
- **Health/Meds**: Temperature logging and medication scheduling.
- **Behavior**: Crying intensity and pattern recognition for "witching hour" detection.

### AI Suggestion Engine (Gemini Pro)
- **Predictive Engine**: Analyzes last 3 feeds to predict the next "hunger window."
- **Health Guard**: Detects dehydration (low wet diapers) or fever clusters.
- **Climate Assistant**: Suggests TOG ratings and layers for Sept/Oct weather.
- **Soothing Engine**: Contextual tips (e.g., "It's been 2 hours since the last nap, Xavian might be overtired. Try white noise.").

### Parent Co-Pilot Module
- **Real-Time Handshake**: Firestore listeners ensure Parent A sees exactly what Parent B just logged.
- **Smart Handoff**: Shift-aware logic ("Parent B has done 3 night feeds, Parent A prompted to take the 6 AM shift").
- **Night Mode**: High-contrast, low-blue-light UI for 3 AM interactions.

### Safety Layer
- **High-Priority Alerts**: Immediate visual cues for fever or respiratory flags.
- **Safe Sleep Reminders**: Contextual "Back to Sleep" prompts during sleep logs.
- **Professional Bridge**: Quick-dial pediatricians or emergency guidance.

## 2. Data Flow

1. **Input (Event Source)**: Parent speaks, types, or taps a "Quick Action" button.
2. **NLU Layer (Gemini)**: Raw input is converted to a structured `CareLog` object.
3. **Pattern Analysis**: The structured data is compared against previous logs (last 24h).
4. **Output Generation**:
   - Save to Firestore (Primary Cluster).
   - Generate AI Feedback (Soothing/Health tip).
   - Schedule Reminders (Local Notifications).
5. **UI Update**: Component state reflects the new log instantly via Firestore `onSnapshot`.

## 3. Storage Strategy
- **Firestore**: Primary data store for shared family state.
- **Local Cache**: Service Workers cache UI assets; partial log caching for offline persistence.
