# Autonomic HR Pacer v1.1

**[Launch the Live App Here](https://cj-hilder.github.io/ble-hr-tool/)**

A specialized, web-based heart rate pacing app designed for individuals with dysautonomia (such as POTS, Long COVID, ME/CFS, or Post Concussion Syndrome). 

## The Problem
Most commercial exercise apps and smart watches are built for healthy individuals with well-regulated autonomic nervous systems. They assume your heart rate will rise predictably when you exert yourself and drop predictably when you stop. 

Patients with dysautonomia have two needs that are not catered for by most apps: they require strict heart rate pacing and they need to accommodate a dysregulated heart. These needs apply to both exercise and performing daily tasks.

This app helps with strict pacing by providing an alert, both sound and vibration, when heart rate thresholds are crossed. This makes it possible to follow strict pacing without having to continually watch the screen. 

In addition, this app allows you to visualise heart rate regulation and provides some measurements (response lag, HR overshoot, total activity time) that help in managing and assessing progress. 

## How the Pacing Logic Works

The app operates in four primary states.

### 🟢 Continue activity
You are safely within your physiological exercise zone, between your bradycardia threshold at the bottom and your active threshold at the top. The app tracks total activity time to help you budget the amount of daily activity.

### 🟠 Rest or pull back
You have hit your active threshold and need to rest completely or reduce effort enough to bring your heart rate down. The app actively tracks how long it takes for your heart rate to start coming down. If your heart rate comes down quickly enough you will be returned to "Continue activity", otherwise to "Reset".

### 🔴 Reset to resting HR
You have pushed too far and failed to recover, or you manually tapped the 'reset' button. The app now waits for your heart rate to return to your resting heart rate. When it does you will be returned to "Continue activity".
* **Session Termination:** If you are forced into the Reset state several times in a single session, the app advises you to end the session.

### ⚫ Pause
If the app is showing "Continue activity", but you want to rest, you can pause the session. This means you can rest without the time being counted as activity. When you are ready, tap 'Resume session' and get back into it.

## Settings
You must adjust the settings to suit your personal situation. This might involve trial and error until you find the settings that let you maximise exercise while minimising symptoms and staying within your known heart rate limits.

---
## ✨ Features
* **Direct Bluetooth Low Energy (BLE) Connection:** Connects directly to standard BLE heart rate monitors (like Polar straps or watches) via the browser.
* **Progressive Web App (PWA):** Installable directly to an Android home screen for fullscreen, app-like behavior.
* **Minimalist design:** Large, accessible UI with clear visualisation of heart rate changes. 

---
## Requirements & Usage

Because this app relies on the **Web Bluetooth API**, it requires a compatible browser and operating system.
* **Supported:** Android devices running Google Chrome, Chrome on Desktop (Windows/Mac).
* **Not Supported:** iOS devices (Apple Safari does not currently support Web Bluetooth natively).

### Setup Instructions
1. Open the app on your Android device by visiting: **[cj-hilder.github.io/ble-hr-tool](https://cj-hilder.github.io/ble-hr-tool/)**
2. Tap the browser menu (three dots) and select **"Add to Home screen"** or **"Install App"**. 
3. Launch the app from your home screen.
4. Put your heart rate monitor into pairing/broadcasting mode (e.g., on a Polar watch, select a workout and tap the gear icon to turn on "Share HR with other devices").
5. Tap **Connect to HR monitor** and select your device from the browser popup.

### Common Bluetooth Troubleshooting
Bluetooth LE can be finicky, especially on Android devices. If the app connects but freezes on a black screen without showing your heart rate, **your phone and watch or HR monitor are likely in a "Half-Paired" state.**

To fix the silent freeze:
1. Close the watch or HR monitor's specific app on your phone e.g. Polar Flow App.
2. **Crucial Step:** Go into your **watch or HR monitor's** internal settings menu and delete/unpair your phone. 
3. Try connecting again. 

## ⚠️ Medical Disclaimer
*This application is provided for informational and educational purposes only. It is not a medical device, nor is it intended to diagnose, treat, cure, or prevent any disease. Always consult with a qualified healthcare provider before beginning any new exercise regimen, especially if you have dysautonomia or other cardiovascular/neurological conditions.*

---

## Author
**Chris Hilder** — [github.com/cj-hilder](https://github.com/cj-hilder)

Built out of personal necessity as someone managing a post-concussion condition with dysautonomia. Feedback, suggestions, and contributions are welcome.

## Licence
This project is licenced under the **Creative Commons Attribution 4.0 International (CC BY 4.0)** licence.

You are free to share and adapt this work for any purpose, including commercially, as long as you give appropriate credit to **Chris Hilder** and indicate if changes were made.

[![CC BY 4.0](https://licensebuttons.net/l/by/4.0/88x31.png)](https://creativecommons.org/licenses/by/4.0/)

Full licence text: [creativecommons.org/licenses/by/4.0](https://creativecommons.org/licenses/by/4.0/)
