# Dysautonomia HR Pacer

**[🚀 Launch the Live App Here](https://cj-hilder.github.io/ble-hr-tool/)**

A specialized, web-based heart rate pacing app designed for individuals with dysautonomia (such as POTS, Long COVID, or ME/CFS). 

## 🧠 The Problem
Most commercial exercise apps and smartwatches are built for healthy individuals with well-regulated autonomic nervous systems. They assume your heart rate will rise predictably when you exert yourself and drop predictably when you stop. 

For patients with dysautonomia, heart rate regulation is often erratic. Spikes happen rapidly, recovery is delayed, and pushing past specific thresholds can trigger severe symptom flare-ups (Post-Exertional Malaise / PEM). This app was built to act as an aggressive, highly-buffered safety rail, helping users exercise or perform daily tasks while strictly staying within their safe physiological limits.

## ✨ Features
* **Direct Bluetooth Low Energy (BLE) Connection:** Connects directly to standard BLE heart rate monitors (like Polar straps or watches) via the browser.
* **Buffered State Logic:** Uses multi-reading buffers to prevent the app from violently switching states due to a single erratic heartbeat.
* **Smart Recovery Tracking:** Monitors not just *how high* your heart rate goes during a rest period, but the **Lag** (how many seconds it takes for your heart rate to peak after you stop moving). 
* **Tactile Manual Overrides:** Large, accessible UI designed for brain fog, including a dedicated manual "Reset/Escape" button.
* **Progressive Web App (PWA):** Installable directly to an Android home screen for fullscreen, app-like behavior.

---

## 🚦 How the Pacing Logic Works

The app operates in three primary states. To accommodate poor heart regulation, transitions between these states are strictly guarded by consecutive-reading buffers and time limits.

*(Note: The thresholds below are currently hardcoded for a Resting HR of 65 and an Active Threshold of 80, but the core logic remains the same).*

### 🟢 Active ("Continue activity")
You are safely within your target exercise zone.
* **To Rest:** HR spikes to or above the Active threshold for **3 consecutive readings**. 
* **To Reset (Bradycardia Drop):** HR suddenly drops 10 BPM *below* your Resting HR for **3 consecutive readings**.

### 🟠 Rest ("Rest or pull back")
You have hit your threshold and need to pause. The app actively tracks your Max HR during this period and the "Lag" time it took to reach that peak.
* **To Active:** HR drops back down to or below your Active threshold for **7 consecutive readings**. (The high buffer ensures you are actually recovering, not just experiencing a momentary dip).
* **To Reset (Failed Recovery):** You remain in the Rest state for more than **4 minutes**, OR your heart rate continues to climb and peaks more than **60 seconds** after you stopped moving (abnormal autonomic lag).

### 🔴 Reset ("Reset to resting HR")
You have pushed too far, failed to recover, or triggered a manual override. You must stop completely.
* **To Active:** HR must stabilize exactly within 5 BPM of your baseline Resting HR for **15 consecutive readings**. 
* **Session Termination:** If you are forced into the Reset state 3 times in a single session, the app advises you to end the session immediately to prevent a flare-up.

---

## 📱 Requirements & Usage

Because this app relies on the **Web Bluetooth API**, it requires a compatible browser and operating system.
* **Supported:** Android devices running Google Chrome, Chrome on Desktop (Windows/Mac).
* **Not Supported:** iOS devices (Apple Safari does not currently support Web Bluetooth natively).

### Setup Instructions
1. Open the app on your Android device by visiting: **[cj-hilder.github.io/ble-hr-tool](https://cj-hilder.github.io/ble-hr-tool/)**
2. Tap the browser menu (three dots) and select **"Add to Home screen"** or **"Install App"**. 
3. Launch the app from your home screen.
4. Put your heart rate monitor into pairing/broadcasting mode (e.g., on a Polar watch, select a workout and tap the gear icon to turn on "Share HR with other devices").
5. Tap **Connect to Watch** and select your device from the browser popup.

### 🛠️ Common Bluetooth Troubleshooting
Bluetooth LE can be finicky, especially on Android devices. If the app connects but freezes on a black screen without showing your heart rate, **your phone and watch are likely in a "Half-Paired" state.**

To fix the silent freeze:
1. Completely force-close the Pacer app and the Google Chrome browser.
2. Close any companion apps (like Polar Flow) running in the background.
3. Toggle your phone's Bluetooth off and back on.
4. **Crucial Step:** Go into your **Watch's** internal settings menu and delete/unpair your phone. 
5. Try connecting through the web app again. 

## ⚠️ Medical Disclaimer
*This application is provided for informational and educational purposes only. It is not a medical device, nor is it intended to diagnose, treat, cure, or prevent any disease. Always consult with a qualified healthcare provider before beginning any new exercise regimen, especially if you have dysautonomia or other cardiovascular/neurological conditions.*
