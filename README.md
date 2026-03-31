# Autonomic HR Pacer v1.2

**[Launch the Live App Here](https://cj-hilder.github.io/ble-hr-tool/)**

A specialised, web-based heart rate pacing app designed for individuals with dysautonomia (such as POTS, Long COVID, ME/CFS, or Post-Concussion Syndrome).

This app was built by a software developer managing their own post-concussion dysautonomia; not by a clinician or researcher. It is a best-effort personal project, grounded in published protocols and personal experience, that has worked well for its author. It may or may not work for you. Nothing here should be taken as medical advice, and it is no substitute for working with a qualified healthcare provider who understands your condition.

---

## The Problem

Most commercial exercise apps and smart watches are built for healthy individuals with well-regulated autonomic nervous systems. They assume your heart rate will rise predictably when you exert yourself and drop predictably when you stop.

Patients with dysautonomia have a different experience. The autonomic nervous system (ANS) loses its normal control, producing three characteristic patterns:

- **HR rises faster and higher than the exertion warrants.**
- **HR recovery is delayed and is slower than normal.** Heart rate continues to go up for a time after stopping exertion, and then comes down slowly.
- **HR overshoots on the way down.** Heart rate drops below normal resting HR before stabilising.

Standard apps have no way to display or respond to any of these patterns. This app is built specifically to help visualise and respond to them.

---

## The Pacing Approach

The app is based on three principles:

1. **Staying as active as possible is essential.** Complete rest leads to deconditioning that worsens the situation. 
2. **A dysregulated ANS means HR will sometimes go too high or too low for the level of exertion.** This cannot always be prevented through careful pacing. The goal is to make it visible and to allow you to respond when it happens.
3. **Only exercise when the heart rate is appropriate to the level of exertion.** When HR goes outside the appropriate range, stop activity until it returns.

The app implements this by monitoring your live heart rate via a Bluetooth HR monitor and alerting you — with sound and vibration — when your heart rate crosses into or out of threshold zones, allowing you to follow strict pacing without having to watch the screen continuously.

This app is intended to help you visualise what your heart is doing and help you pace yourself during exercise. It is not a complete *one-stop shop* for dysautonomia recovery. You must understand your diagnosis, be aware of your symptoms, and know how to track and pace your progress. Do not blindly follow the app, but be aware of your symptoms and be ready to hit the reset button or end the session if needed. Settings can be adjusted mid-session.

---

## Two Recovery Contexts

How you should use the app depends on where you are in your recovery. The two contexts require fundamentally different approaches.

### If you have PEM or chronic fatigue

Your active threshold is a **ceiling, not a target**. The goal is consistent compliance with the limit, not progression. Do not raise the threshold because you feel ready for more.

**Setting the threshold: the Workwell Foundation protocol**

The standard for determining your safe HR ceiling is a two-day Cardiopulmonary Exercise Test (CPET) administered by a specialist, which identifies your individual anaerobic threshold — the point at which your body shifts to less efficient energy production and PEM risk rises sharply. The [Workwell Foundation](https://workwellfoundation.org/pacing-with-a-heart-rate-monitor-to-minimize-post-exertional-malaise-pem-in-me-cfs-and-long-covid/), which pioneered this testing for ME/CFS, recommends that where CPET is unavailable, a safe and practical alternative is to set your threshold at **resting HR + 15 bpm**, using a 7-day average of your waking resting HR as the baseline.

Clinical assessment is always preferable. The RHR + 15 rule is a conservative, accessible alternative that errs on the side of safety rather than maximising your activity.

Success will appear as gradually shorter lag and recovery periods, fewer resets, and more time in the active state — all at a *fixed* threshold.

### If you do not have PEM or chronic fatigue

Your active threshold is a **progressive target**. The goal is to raise it carefully over time as the ANS demonstrates it can handle the current level.

**The Buffalo Protocol — and why it needs adaptation**

The standard clinical approach for post-concussion autonomic rehabilitation is the [Buffalo Concussion Treadmill Test (BCTT)](https://pubmed.ncbi.nlm.nih.gov/24225521/), developed by Drs Leddy and Willer at the University at Buffalo. It identifies your individual symptom threshold through a graded treadmill test, then prescribes exercise at 80–90% of that threshold. This is a well-validated, evidence-based approach when the ANS is sufficiently stable to make the threshold meaningful.

The difficulty with dysautonomia-related HR instability is that the BCTT presupposes a reasonably stable and predictable HR response to exertion. When the heart is poorly regulated it is difficult to either establish, or exercise within, an appropriate threshold. 

A practical alternative is to **start with the Workwell RHR + 15 approach as an initial ceiling**, and progressively raise the threshold as HR regulation and symptoms improve. HR regulation improvement will appear as shorter lag and recovery periods, fewer resets, and more time in the active state. Raise the threshold incrementally and monitor the response watching both HR regulation and symptoms.

This approach uses the same logic as the Buffalo Protocol, sub-symptom threshold exercise to drive autonomic recovery, but replaces the clinical measurement with a conservative starting point and a methodology for ongoing progression.

---

## How the Pacing Logic Works

The app operates in four states.

### 🟢 Continue activity

Your heart rate is within your physiological exercise zone — above the bradycardia threshold and below your active threshold. The app tracks total activity time to help you budget the amount of daily exertion.

If your heart rate drops *below* the bradycardia threshold during activity, the app forces a heart rate Reset. This catches the HR overshoot pattern — an unusually low reading during exertion can indicate that the ANS has already lost control.

An optional **activity time limit** can be configured (see Settings). When your active time for the session reaches that limit, the app automatically triggers a heart rate reset as a reminder to end the session.

### 🟠 Rest or pull back

Your heart rate has hit your active threshold. Stop or significantly reduce activity. The app now tracks two things independently:

- **Response lag:** How many seconds pass before your HR actually starts falling. In a well-regulated ANS this happens within seconds. In dysautonomia it is often delayed. If the lag exceeds your configured limit, the app forces a heart rate Reset.
- **Total recovery time:** If your HR is falling but takes too long to reach your active threshold again, the app also forces a heart rate Reset.

Both are independent safeguards. The response lag catches the delayed-response pattern. The maximum recovery period catches a slow but ultimately failed recovery.

If your HR falls back below your active threshold quickly enough, you are returned to Continue activity.

### 🔴 / 🔵 Reset to resting HR

You have pushed too far and failed to recover in time, or you have manually triggered a reset. The app now waits for your HR to return to your resting HR band and stay there for 15 consecutive seconds before returning you to Continue activity.

This may require you to completely stop and sit down.

**Session termination warning:** If you are forced into Reset several times in a single session, the app displays a prominent warning advising you to end the session.

**Resonance Frequency Breathing during reset**: If Resonance Frequency Breathing is enabled (see below), a breathing guide is displayed during the reset. See the dedicated section below.

### ⚫ Pause

You are currently in the active state but want to rest voluntarily — not because the app has detected a problem, but because you are choosing to rest. Pausing stops the activity timer without triggering a state change. When you are ready, tap Resume and continue the session.

---

## Resonance Frequency Breathing (RFB)

Resonance Frequency Breathing is a biofeedback technique. At a particular breathing rate respiratory and cardiac rhythms enter resonance. This is typically around 6 breaths per minute, but varying between individuals in the range of 4.5–7 bpm. The heart rate rises during each inhale and falls during each exhale in a pattern called **Respiratory Sinus Arrhythmia (RSA)**. When breathing rate matches the body's resonance frequency, RSA amplitude is maximised.  RSA amplitude is a direct expression of vagal tone (the parasympathetic nervous system's capacity to regulate the heart).

For people with dysautonomia, vagal tone is typically suppressed, which is part of what produces the dysregulated HR patterns the app is designed to manage. Regular RFB practice at the resonance frequency, particularly during rest periods, has evidence of increasing vagal tone over time.

The app integrates RFB directly into the Reset state, turning a  rest period into a structured, guided recovery practice.

**Note** If you have been exercising at a level that causes you to breathe heavily, wait until
your breathing has settled down before attempting to follow the breathing guide, otherwise you will be depriving your system of oxygen by breathing too slowly. 

### How it works

When RFB is enabled in settings, entering the Reset state transforms the experience:

- **The status dot turns blue** and **pulses in and out** as a breath pacer — expanding during inhale, contracting during exhale, with a subtle flash at each transition.
- **A sine wave overlay** appears on the HR graph, showing the HR pattern your heart *should* produce if breathing is coupled to the breath pacer. This gives you a visual target for coherence.
- **Sound guidance** — a rising filtered noise during each inhale, brightening in frequency as the inhale progresses, then falling silent during the exhale. Allows you to follow the breath without watching the screen.
- **Vibration guidance** — an opening pulse at the start of each inhale, followed by a buzzing that accelerates in frequency through the inhale, and a closing pulse at the end. Provides a tactile breath guide.
- **Once your HR has returned to your resting band for 15 seconds**, the app enters an extended RFB phase — shown as a countdown timer — before returning you to Continue activity. The default is 2 minutes. This is the core of the practice: staying in the resonance breathing state after the HR has settled, deepening the vagal recovery before returning to exertion.

### Coherence score

If you are using a **Polar H10** chest strap (or any sensor that exposes raw RR intervals via the Bluetooth Heart Rate Measurement characteristic), the app can calculate a **live coherence score** — a spectral measure of how tightly your beat-to-beat HR oscillations are locked to the breathing rhythm.

The score appears as a percentage and a star rating beneath the state description during the Reset state. 

| Rating | Percentage | Coherence |
| :--- | :--- | :--- |
| ☆☆☆ | < 15% | None |
| ★☆☆ | ≥ 15% | Low |
| ★★☆ | ≥ 30% | Moderate |
| ★★★ | ≥ 50% | Strong |

The score requires approximately one minute of RR data to compute accurately, and always appears as 0 at first until enough data is available. 

**Important:** Do not stress over achieving a high score. Stressing about the number will actively lower it. A perfectly conditioned nervous system might hold 60–80%. With dysautonomia, your baroreflex is out of practice — scores of 15–20% early in your practice are completely normal and a solid starting point. The goal is stability and a slow upward trend over weeks, not an impressive number in any individual session. A flat coherence score — or even a flat HR line — is physiologically expected when the ANS is depleted or sympathetically dominant. The visible oscillation grows as ANS function recovers.

The breath pacer and coherence score are most meaningful as a longitudinal tool: tracking whether your star rating and percentage gradually improve over weeks of consistent practice is a meaningful recovery signal.

Polar and most other sports watches (as opposed to the Polar H10 chest strap) report rolling-averaged HR rather than beat-to-beat RR intervals, which will produce a flat coherence score regardless of actual RSA. The H10 is strongly recommended for this feature.

### Finding your personal resonance frequency

Your resonance frequency is the exact breathing rate at which your cardiovascular and autonomic nervous systems fall into sync — the rate that produces your highest coherence score. For most adults this falls between 4.5 and 7.0 breaths per minute, but it is individual and worth finding precisely.

**Practical method:**

1. Breathe at 6.0 bpm (the 5s/5s default) for one full RFB session and note your average coherence score.
2. The next session, try 5.5 bpm. The session after, try 5.0 bpm.
3. Compare the scores. Your true resonance frequency is the pace that produces your highest coherence score while feeling the most effortless and natural.

Adjust the breathing rate using the **Inhale / Exhale** fields in RFB settings, stepping in 0.5 bpm increments. Once found, your resonance frequency is likely to remain relatively stable — lock it in and use it for all future sessions.

### RFB Settings

- **Enable RFB** — Master toggle. When off, the Reset state behaves as a stop activity state (red dot, no breath pacer).
- **Inhale / Exhale** — The duration of each phase in seconds. The resulting breathing rate in bpm is shown below these fields. The default 5s inhale and 5s exhale produces a 6 bpm cycle. A slight emphasis on the exhale (e.g. 4s in / 6s out) can further increase parasympathetic tone.
- **RFB duration** — How long to remain in the RFB phase after resting HR is achieved. Default is 2 minutes.
- **Inhale sound guide** — Toggle the rising noise guide.
- **Inhale vibration guide** — Toggle the tactile buzz guide.

---

## Getting the Most from Your RFB Sessions

### How to Breathe: Light, Slow, and Low

The most common mistake is taking large, heavy breaths. Over-breathing blows off too much carbon dioxide, which can trigger a stress response and produce dizziness or anxiety — the opposite of the intended effect. Instead, follow three rules:

**Breathe lightly.** Take in the same small volume of air you would while sitting quietly. Do not fill your lungs to capacity.

**Breathe low.** Direct that small sip of air down into your belly. Your stomach should gently expand outward while your chest and shoulders remain completely still.

**Exhale passively.** Do not use your muscles to push the air out. Just relax your airways and let the air fall out naturally, like a tyre slowly deflating.

> **Note:** You may feel a mild sensation of "air hunger" — a slight urge to take a bigger breath. This is actually a good sign that your blood vessels are relaxing. Tolerate it gently. Never push into discomfort or panic.

### Knowing When to Stop

Your nervous system is currently deconditioned, meaning it fatigues quickly. Pushing through that fatigue will backfire and produce a stress response. Stop the RFB session and consider it a success if you notice any of the following:

**The coherence crash.** If your score has been sitting in the ★☆☆ or ★★☆ range and then suddenly drops to ☆☆☆ or near-zero, your autonomic nervous system has fatigued. This is the equivalent of muscular failure — you have successfully completed your training stimulus for the day. Stop the timer.

**Brain fog or frustration.** Paced breathing requires sustained focus. If your mind is wandering, you feel agitated, or you are struggling to hold the rhythm, your cognitive battery is empty.

**Physical red flags.** If mild air hunger turns into a racing heart, dizziness, or anxiety, stop immediately and let your breathing return to its natural pattern.

Two minutes of comfortable, high-quality breathing is vastly superior to ten minutes of struggling. Stop while you are ahead. The goal is not duration — it is quality, and a consistently gentle practice will build capacity far more reliably than straining for longer sessions.

---

## Settings

You must adjust the settings to suit your personal situation. Changes take effect immediately and are saved per activity type. The defaults correspond to an 80 BPM upper threshold protocol, which is a reasonable starting point for many people with post-concussion or ME/CFS-related dysautonomia, but individual variation is significant and you should expect some trial and error.

The key parameters and their purpose:

**Heart rate range**
- *Max HR* — Used to scale the speedometer and history graph. Use a calculator based on your age and sex (in dysautonomia, formula-derived estimates are generally more meaningful than a measured maximum). This is not used in any state transitions so it is not critical that it is your *correct* maximum HR.
- *Bradycardia threshold* — HR below this during activity triggers a heart rate Reset. Set it to a level that represents a clearly abnormal low for your resting state.

**Resting HR**
- *Resting HR* and *Bandwidth* — The target you must return to during a heart rate Reset, and the window around it. HR must stay within this band for 15 consecutive seconds for a heart rate Reset to complete.

**Active thresholds**
- *Upper threshold* — The ceiling for the Active state. If unsure, resting HR + 15 is a conservative starting point.
- *Lower threshold* — HR must fall below this to transition from 'Rest or pull back' to 'Active'. Usually set just below the upper threshold.
- *Activity time limit* — Total active time allowed per session, in minutes. When reached, the app transitions to the heart rate Reset state and the state description reads "Activity limit reached". The session does not end automatically — you may choose to continue or end voluntarily. Set to 0 to disable.

**Recovery limits**
- *Max recovery period* — The total time allowed in 'Rest or pull back' before a forced heart rate Reset.
- *Max response lag* — How long HR is allowed to keep rising after entering 'Rest or pull back' before a heart rate Reset is forced. This specifically targets the delayed-recovery pattern.
- *Resets before warning* — How many heart rate Resets trigger the end-session advisory.

**Target zone**
- *Target min / max* — A visual guide shown on the speedometer. Purely informational, does not affect state transitions.

**Alerts**
- *Vibration / Sound* — Intensity of the state-transition alerts (Off / Subtle / Intense).

**Resonance Frequency Breathing**
- See the dedicated RFB section above.

---

## ✨ Features

- **Direct Bluetooth Low Energy (BLE) connection** — Connects directly to standard BLE heart rate monitors (like Polar straps or watches) via the browser. Compatible with any device that implements the standard Heart Rate Measurement characteristic.
- **Raw RR interval support** — For devices that expose beat-to-beat RR data (such as the Polar H10), the app uses instantaneous heart rate on the HR graph rather than the sensor's rolling average. This higher-resolution signal is required for the RFB coherence score.
- **Sound and vibration alerts** — Configurable intensity on both, designed to be usable while active without watching the screen.
- **Progressive Web App (PWA)** — Installable directly to an Android home screen for fullscreen, app-like behaviour.
- **Multiple activity profiles** — Different threshold sets for different activities (e.g. walking, cycling, housework), switchable at session start.
- **Activity time limit** — Optional per-session cap on total active time. When reached, the app transitions to the heart rate Reset state automatically.
- **Resonance Frequency Breathing** — Integrated breath pacer, sound and vibration guides, coherence scoring, and extended RFB phase during the Reset state. See dedicated section above.
- **Session HR recording and graph export** — Every session records 1Hz heart rate data alongside state transitions. Saved sessions can be exported as a landscape A4 PDF graph showing HR over time with colour-coded state background bands, axes, and a resting HR reference line.
- **Session history and trend graphs** — Each session can be saved with notes. History graphs allow you to track recovery metrics over time.
- **Response lag and HR overshoot tracking** — Per-session statistics on recovery lag, HR peak during rest, and active/recovery time ratios.
- **Minimalist design** — Large, accessible UI with clear visualisation of live heart rate and state.

---

## Session Graph

Each saved session includes a 1Hz recording of heart rate and state. From the Session History page, tap **"📈 View Session Graph (PDF)"** on any session to generate and download a landscape A4 PDF.

The graph shows:
- **Heart rate** as a continuous line over the full session duration
- **State** as colour-coded background bands, matching the dot colours in the training view: green for active periods, orange for rest, red for reset (blue if RFB was enabled), and grey for pause
- **Resting HR** as a dashed blue reference line (from the activity settings used in that session)
- **Time axis** in mm:ss with auto-scaled gridlines
- **HR axis** in bpm with auto-scaled gridlines
- **Session metadata** in the header: date, time, activity type, duration, and average HR
- **Legend** showing only the states that actually occurred in the session

Older sessions saved before this feature was introduced will not have the recording and the button will not appear.

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

### Recommended Hardware

Any BLE heart rate monitor that implements the standard Heart Rate Measurement characteristic will work for basic pacing. For the **RFB coherence score** and higher-resolution HR graphing, a device that exposes raw RR intervals is required. The **Polar H10** chest strap is strongly recommended — it is the most widely used research-grade consumer device for this purpose and reliably exposes RR data via the standard BLE characteristic without requiring a proprietary app or API.

### Common Bluetooth Troubleshooting

Bluetooth LE can be finicky, especially on Android. If the app connects but freezes without showing your heart rate, your phone and watch are likely in a "half-paired" state.

To fix this:
1. Close the watch or HR monitor's companion app on your phone (e.g. Polar Flow).
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
