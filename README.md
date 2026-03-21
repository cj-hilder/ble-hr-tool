# Autonomic HR Pacer v1.1

**[Launch the Live App Here](https://cj-hilder.github.io/ble-hr-tool/)**

A specialised, web-based heart rate pacing app designed for individuals with dysautonomia (such as POTS, Long COVID, ME/CFS, or Post-Concussion Syndrome).

This app was built by a software developer managing their own post-concussion dysautonomia; not by a clinician or researcher. It is a best-effort personal project, grounded in published protocols and personal experience, that has worked well for its author. It may or may not work for you. Nothing here should be taken as medical advice, and it is no substitute for working with a qualified healthcare provider who understands your condition.

---

## The Problem

Most commercial exercise apps and smart watches are built for healthy individuals with well-regulated autonomic nervous systems. They assume your heart rate will rise predictably when you exert yourself and drop predictably when you stop.

Patients with dysautonomia have a fundamentally different experience. The autonomic nervous system (ANS) loses its normal gain control, producing three characteristic patterns:

- **HR rises faster and higher than the exertion warrants**
- **HR recovery is delayed and is slower than normal ** — heart rate continues to go up for a time after stopping exertion, and then comes down slowly.
- **HR sometimes overshoots on the way down** — heart rate  drops below normal resting HR before stabilising.

Standard apps have no way to detect or respond to any of these patterns. This app is built specifically around them.

---

## The Pacing Approach

The app is based on three principles:

1. **Staying as active as possible is essential.** Complete rest leads to deconditioning that worsens the situation. 
2. **A dysregulated ANS means HR will sometimes go too high or too low for the level of exertion.** This cannot always be prevented through careful pacing. The goal is to respond correctly *when it happens*, not to predict and avoid it perfectly.
3. **When HR goes outside the range appropriate for the current level of exertion, stop all activity until it returns.** Only exercise when the heart is in range.

The app implements this by monitoring your live heart rate via a Bluetooth HR monitor and alerting you — with sound and vibration — when your heart rate crosses into or out of threshold zones, allowing you to follow strict pacing without having to watch the screen continuously.

---

## Two Recovery Contexts

How you should use the app depends on where you are in your recovery. The two contexts require fundamentally different approaches.

### If you have PEM or chronic fatigue

Your active threshold is a **ceiling, not a target**. The goal is consistent compliance with the limit, not progression. Do not raise the threshold because you feel ready for more — in the presence of PEM risk, that instinct should be resisted.

**Setting the threshold: the Workwell Foundation protocol**

The standard for determining your safe HR ceiling is a two-day Cardiopulmonary Exercise Test (CPET) administered by a specialist, which identifies your individual anaerobic threshold — the point at which your body shifts to less efficient energy production and PEM risk rises sharply. The [Workwell Foundation](https://workwellfoundation.org/pacing-with-a-heart-rate-monitor-to-minimize-post-exertional-malaise-pem-in-me-cfs-and-long-covid/), which pioneered this testing for ME/CFS, recommends that where CPET is unavailable, a safe and practical alternative is to set your threshold at **resting HR + 15 bpm**, using a 7-day average of your waking resting HR as the baseline.

Clinical assessment is always preferable. The RHR + 15 rule is a conservative, accessible alternative that errs on the side of safety rather than maximising your activity.

Success looks like: gradually shorter recovery periods, fewer resets, and more time in the active state — all at a *fixed* threshold. The session history graphs are there to show improving ANS regulation quality at your current limit. That stabilisation is the prerequisite for eventually considering progression, not a signal to push immediately.

### If you do not have PEM or chronic fatigue

Your active threshold is a **progressive rehabilitation target**. The goal is to raise it carefully over time as the ANS demonstrates it can handle the current level.

**The Buffalo Protocol — and why it needs adaptation**

The standard clinical approach for post-concussion autonomic rehabilitation is the [Buffalo Concussion Treadmill Test (BCTT)](https://pubmed.ncbi.nlm.nih.gov/24225521/), developed by Drs Leddy and Willer at the University at Buffalo. It identifies your individual symptom threshold through a graded treadmill test, then prescribes exercise at 80–90% of that threshold. This is a well-validated, evidence-based approach when the ANS is sufficiently stable to make the threshold meaningful.

The difficulty with dysautonomia-related HR instability is that the BCTT presupposes a reasonably stable and predictable HR response to exertion. When the heart is poorly regulated it is difficult to either establish or stick to an appropriate threshold. 

A practical alternative is to **start with the Workwell RHR + 15 approach as an initial ceiling**, and progressively raise the threshold as HR regulation and symptoms improve. The session history graphs provide the evidence to guide those adjustments: sustained reductions in recovery lag times and reset frequency at a stable threshold are reasonable indicators that a modest upward increment is warranted. Raise the threshold incrementally and monitor the response over several sessions before raising it again.

This approach uses the same logic as the Buffalo Protocol, sub-symptom threshold exercise to drive autonomic recovery, but replaces the clinical measurement with a conservative starting point and a methodology for ongoing progression.

### Transitioning between contexts

The distinction is not always fixed. Some people transition from the first context to the second as they recover. The history graphs are intended to help detecting that transition: if lag times and reset counts show consistent improvement over weeks at a stable threshold, this may indicate that PEM risk has receded enough to consider cautious progression. This transition should ideally be discussed with your healthcare provider.

---

## How the Pacing Logic Works

The app operates in four states.

### 🟢 Continue activity

Your heart rate is within your physiological exercise zone — above the bradycardia threshold and below your active threshold. The app tracks total activity time to help you budget the amount of daily exertion.

If your heart rate drops *below* the bradycardia threshold during activity, the app forces a heart rate Reset. This catches the HR overshoot pattern — an unusually low reading during exertion can indicate that the ANS has already lost control in the downward direction.

### 🟠 Rest or pull back

Your heart rate has hit your active threshold. Stop or significantly reduce activity. The app now tracks two things independently:

- **Response lag:** How many seconds pass before your HR actually starts falling. In a well-regulated ANS this happens within seconds. In dysautonomia it is often delayed. If the lag exceeds your configured limit, the app forces a heart rate Reset.
- **Total recovery time:** If your HR is falling but takes too long to reach your active threshold again, the app also forces a heart rate Reset.

Both are independent safeguards. The response lag catches the delayed-response pattern. The maximum recovery period catches a slow but ultimately failed recovery.

If your HR falls back below your active threshold quickly enough, you are returned to Continue activity.

### 🔴 Reset to resting HR

You have pushed too far and failed to recover in time, or you have manually triggered a reset. The app now waits for your HR to return to your resting HR band and stay there for 15 consecutive seconds before returning you to Continue activity.

This may require you to completely stop and sit down. 

**Session termination warning:** If you are forced into Reset several times in a single session, the app displays a prominent warning advising you to end the session. Repeated ANS failures within a session are a signal to stop, not to push through.

### ⚫ Pause

You are currently in the active state but want to rest voluntarily — not because the app has detected a problem, but because you are choosing to rest. Pausing stops the activity timer without triggering a state change. When you are ready, tap Resume and continue the session.

---

## Settings

You must adjust the settings to suit your personal situation. Changes take effect immediately and are saved per activity type. The defaults correspond to an 80 BPM upper threshold protocol, which is a reasonable starting point for many people with post-concussion or ME/CFS-related dysautonomia, but individual variation is significant and you should expect some trial and error.

The key parameters and their purpose:

**Heart rate range**
- *Max HR* — Used to scale the speedometer and history graph. Use a calculator based on your age and condition; in dysautonomia, formula-derived estimates are generally more meaningful than a measured maximum. (This is not used in any calculations so it is not critical that it is your correct maximum HR.)
- *Bradycardia threshold* — HR below this during activity triggers a heart rate Reset. Set it to a level that represents a clearly abnormal low for your resting state.

**Resting HR**
- *Resting HR* and *Bandwidth* — The target you must return to during a heart rate Reset, and the window around it. HR must stay within this band for 15 consecutive seconds for a heart rate Reset to complete.

**Active thresholds**
- *Upper threshold* — The ceiling for the Active state. If unsure, resting HR + 15 is a conservative starting point.
- *Lower threshold* — HR must fall below this to exit Rest or pull back to Active. Usually set just below the upper threshold.

**Recovery limits**
- *Max recovery period* — The total time allowed in Rest or pull back before a forced heart rate Reset.
- *Max response lag* — How long HR is allowed to keep rising after entering Rest or pull back before a heart rate Reset is forced. This specifically targets the delayed-recovery pattern.
- *Resets before warning* — How many heart rate Resets trigger the end-session advisory.

**Target zone**
- *Target min / max* — A visual guide shown on the speedometer. Purely informational, does not affect state transitions.

---

## ✨ Features

- **Direct Bluetooth Low Energy (BLE) connection** — Connects directly to standard BLE heart rate monitors (like Polar straps or watches) via the browser.
- **Sound and vibration alerts** — Configurable intensity on both, designed to be usable while active without watching the screen.
- **Progressive Web App (PWA)** — Installable directly to an Android home screen for fullscreen, app-like behaviour.
- **Multiple activity profiles** — Different threshold sets for different activities (e.g. walking, cycling, housework), switchable at session start.
- **Session history and trend graphs** — Each session can be saved with notes. History graphs allow you to track recovery metrics over time.
- **Response lag and HR overshoot tracking** — Per-session statistics on recovery lag, HR peak during rest, and active/recovery time ratios.
- **Minimalist design** — Large, accessible UI with clear visualisation of live heart rate and state.

---

## Requirements & Usage

Because this app uses the **Web Bluetooth API**, it requires a compatible browser and operating system.

- **Supported:** Android devices running Google Chrome; Chrome on Desktop (Windows/Mac).
- **Not supported:** iOS devices (Apple Safari does not currently support Web Bluetooth natively).

### Setup Instructions

1. Open the app on your Android device: **[cj-hilder.github.io/ble-hr-tool](https://cj-hilder.github.io/ble-hr-tool/)**
2. Tap the browser menu (three dots) and select **"Add to Home screen"** or **"Install App"**.
3. Launch the app from your home screen.
4. Put your heart rate monitor into pairing/broadcasting mode (e.g. on a Polar watch, select a workout and tap the gear icon to enable "Share HR with other devices").
5. Tap **Connect to HR monitor** and select your device from the browser popup.

### Common Bluetooth Troubleshooting

Bluetooth LE can be finicky, especially on Android. If the app connects but freezes without showing your heart rate, your phone and watch are likely in a "half-paired" state.

To fix this:
1. Close the watch or HR monitor's  companion app on your phone (e.g. Polar Flow).
2. **Crucial step:** Go into your watch or HR monitor's own settings menu and delete/unpair your phone from there.
3. Try connecting again.

---

## ⚠️ Medical Disclaimer

*This application is provided for informational and educational purposes only. It is not a medical device, nor is it intended to diagnose, treat, cure, or prevent any disease. Always consult with a qualified healthcare provider before beginning any new exercise regimen, especially if you have dysautonomia or other cardiovascular or neurological conditions.*

---

## Author

**Chris Hilder** — [github.com/cj-hilder](https://github.com/cj-hilder)

Built out of personal necessity as someone managing a post-concussion condition with dysautonomia. Feedback, suggestions, and contributions are welcome.

## Licence

This project is licenced under the **Creative Commons Attribution 4.0 International (CC BY 4.0)** licence.

You are free to share and adapt this work for any purpose, including commercially, as long as you give appropriate credit to **Chris Hilder** and indicate if changes were made.

[![CC BY 4.0](https://licensebuttons.net/l/by/4.0/88x31.png)](https://creativecommons.org/licenses/by/4.0/)

Full licence text: [creativecommons.org/licenses/by/4.0](https://creativecommons.org/licenses/by/4.0/)
