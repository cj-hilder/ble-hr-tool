# Autonomic HR Pacer v1.2

**[Launch the Live App Here](https://cj-hilder.github.io/ble-hr-tool/)**

A specialised, web-based heart rate pacing app designed for individuals with dysautonomia (such as POTS, Long COVID, ME/CFS, or Post-Concussion Syndrome).

This app is intended to help you visualise what your heart is doing and help you pace yourself during exercise. It is not intended for logging symptoms, nor does it analyse the data and offer advice. To use this app effectively you need to be aware of your symptoms, and understand how to pace your progress. 

[Quick Start Guide](https://cj-hilder.github.io/ble-hr-tool/quick_start_guide.html)

This app was built by a software developer managing their own post-concussion dysautonomia; not by a clinician or researcher. It is a best-effort personal project, grounded in published protocols and personal experience, that has worked well for its author. It may or may not work for you. Nothing here should be taken as medical advice, and it is no substitute for working with a qualified healthcare provider who understands your condition.

> **Note:** Wrist based (optical) heart rate sensors are not usually suitable for measuring heart rate in the presence of dysautonomia. They are misled by irregular beats, weak pulse strength, and arm movement. They will often be significantly wrong by upwards of 30 bpm. A chest strap sensor, e.g. Polar H10, is mandatory for HR based pacing with dysautonomia.

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

Do not blindly follow the app. Be ready to adjust the settings, hit the reset button, or end the session if needed.

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

## The Live HR Graph

Your heart rate is graphed continuously on screen. The display shows the last 90 secs of data. 

When connected to a sensor that exposes raw beat-to-beat RR intervals, such as the Polar H10, this graph shows **unsmoothed, instantaneous heart rate**. This is not the smoothed heart rate graph that most fitness apps show. It shows every little variation and will be quite jagged, especially when you are at rest or low levels of exertion.

>One consequence is that you will see **ectopic heart beats**  if any occur, and they will be included in the session summary. Ectopics are beats that fire outside the normal cardiac rhythm. There are two common types:
>
>- **PVC (premature ventricular contraction):** A beat that fires early. On the graph it appears as a **sharp spike upward, immediately followed by a smaller spike downward**. 
>- **PAC (premature atrial contraction):** A beat that fires early and resets your cardiac rhythm. On the graph it appears as a **spike upward with no corresponding downward spike**.
>
>Occasional ectopics are completely normal. Anything under 1% of beats being ectopic is generally considered negligible, and up to a few hundred ectopic beats a day is entirely normal for a healthy, functioning heart. Seeing some on the graph is not a cause for concern — this is the app doing exactly what it says: showing you your cardiac data rather than hiding it. The number of ectopic beats varies widely for all sorts of reasons. They are **not** a useful way to track ANS health: they are a curiosity rather than a diagnostic tool. However, if you regularly see more than 5%, or a significant change in rate above 1%, it may be worth mentioning to a clinician.

---

## Resonance Frequency Breathing (RFB)

Resonance Frequency Breathing is a biofeedback technique. Regular RFB practice has evidence of increasing vagal tone over time.

At a particular breathing rate respiratory and cardiac rhythms enter resonance. This is typically around 6 breaths per minute, but varying between individuals in the range of 4.5–7 bpm. The heart rate rises during each inhale and falls during each exhale. When breathing rate matches the body's resonance frequency the amplitude of these oscillations is maximised.

This app integrates RFB directly into the Reset state, turning a  rest period into a structured, guided recovery practice.

It also allows you to practice resonance frequency breathing on its own, as an activity type. To do this, choose "Resonance Breathing" from the activity drop-down menu.

**Note** If you have been exercising at a level that causes you to breathe heavily, wait until
your breathing has settled down before attempting to follow the breathing guide, otherwise you will be depriving your system of oxygen by breathing too slowly. 

### How it works

You can choose "Resonance Breathing" from the activity drop-down menu, or for any other activity you can enable it in settings, which transforms the heart rate Reset into resonance frequency breathing.

- **The status dot turns blue** and **pulses in and out** as a breath pacer — expanding during inhale, contracting during exhale, with a subtle flash at each transition.
- **A sine wave overlay** appears on the HR graph, showing the HR pattern your heart *could* produce if breathing is well coupled to the breath pacer. This gives you a visual target for coherence. The overlay is only shown when connected to an RR-capable sensor such as the Polar H10 — a rolling-averaged HR signal from a watch cannot meaningfully track these oscillations.
- **Sound guidance** — a rising filtered noise during each inhale, brightening in frequency as the inhale progresses, then falling silent during the exhale. Allows you to follow the breath without watching the screen.
- **Vibration guidance** — an opening pulse at the start of each inhale, followed by a buzzing that accelerates in frequency through the inhale, and a closing pulse at the end. Provides a tactile breath guide.
- **During heart rate Reset, once your HR has returned to your resting HR**, the app enters an extended RFB phase — shown as a countdown timer — before returning you to Continue activity. The default is 2 minutes. This promotes staying in the resonance breathing state after the HR has settled, deepening the  recovery before returning to exertion.

### Resonance score

If you are using a **Polar H10** chest strap (or any sensor that exposes raw RR intervals via the Bluetooth Heart Rate Measurement characteristic), the app can calculate a **live resonance score**. This is a combination of wave coherence, frequency stability, and phase lag. It takes more than 60 seconds to gather enough data to calculate a score.

Once enough data has been gathered, the score appears as a number and a star rating beneath the state description. 

| Rating | Score | Resonance |
| :--- | :--- | :--- |
| ☆☆☆ | < 30 | Very Low |
| ★☆☆ | ≥ 30 | Low |
| ★★☆ | ≥ 45 | Moderate |
| ★★★ | ≥ 65 | Strong |

**Important:** Do not stress over achieving a high score. Stressing about the number will actively lower it. A healthy nervous system is, with practice, usually capable of scores over 65 or three stars. With dysautonomia scores of 20–30 early in your recovery are completely normal and a solid starting point. The goal is stability and a slow upward trend over weeks, not an impressive number in any individual session. A low score, or even a flat HR line, is physiologically expected when the ANS is depleted. The score will increase as ANS function recovers.

Changes in the score during a session or during the day can be used to detect ANS fatigue and may be useful as a cue to stop for the day. This applies if you have achieved a stable score which then declines during the session or over the day.

Tracking your star rating and score over weeks may be of use for tracking your recovery. However the main expected benefit of  resonance frequency breathing is that it promotes recovery, not that it is a recovery tracking tool.

### Finding your personal resonance frequency

Your resonance frequency is the exact breathing rate at which your cardiovascular and autonomic nervous systems fall into sync — the rate that produces your highest resonance score. For most adults this falls between 4.5 and 7.0 breaths per minute, but it is individual and worth finding precisely.

**Practical method:**

1. Breathe at 6.0 bpm (the 5s/5s default) for one full RFB session and note your average resonance score.
2. The next session, try 5.5 bpm. The session after, try 5.0 bpm.
3. Compare the scores. Your true resonance frequency is the pace that produces your highest score while feeling the most effortless and natural.

Adjust the breathing rate using the **Inhale / Exhale** fields in RFB settings, stepping in 0.5 bpm increments. Once found, your resonance frequency is likely to remain relatively stable — lock it in and use it for all future sessions.

### RFB Settings

- **Enable RFB** — Master toggle. When off, the Reset state behaves as a stop activity state (red dot, no breath pacer).
- **Inhale / Exhale** — The duration of each phase in seconds. The resulting breathing rate in bpm is shown below these fields. The default 4s inhale and 6s exhale produces a 6 bpm cycle.
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

If your nervous system is currently deconditioned, it will fatigue quickly. Pushing through that fatigue will backfire and produce a stress response. Stop the RFB session and consider it a success if you notice any of the following:

**The resonance crash.** If your score has been sitting in the ★☆☆ or ★★☆ range and then suddenly drops to ☆☆☆ or near-zero, your autonomic nervous system has fatigued. This is the equivalent of muscular failure — time to stop for the day.

**Brain fog or frustration.** Paced breathing requires sustained focus. If your mind is wandering, you feel agitated, or you are struggling to hold the rhythm, your cognitive battery is empty.

**Physical red flags.** If mild air hunger turns into a racing heart, dizziness, or anxiety, stop RFB immediately and let your breathing return to its natural pattern.

Two minutes of comfortable, high-quality breathing is vastly superior to ten minutes of struggling. Stop while you are ahead. The goal is not duration — it is quality, and a consistently gentle practice will build capacity far more reliably than straining for longer sessions.

---

## HRV Reading

An HRV Reading gives you a single number that summarises your heart rate variability. It is useful as a longitudinal recovery signal, provided you take readings under similar circumstances. 

Consistent morning readings, taken at the same time each day — before getting up or after a few minutes of quiet rest — will give the most comparable longitudinal data. There is no 'correct' HRV that you should aim for, but as your autonomic health improves your HRV is expected to also improve. 

Select **"HRV Reading"** from the activity drop-down menu to start a new reading.

Wait until your heart rate has settled to your resting heart rate before starting. The displayed HRV number will change during the session, converging on the final value. If it jumps up and down by more than a few points you may have started the reading before your heart rate has settled.

### During the session

- **The status dot turns purple** for the duration of the reading.
- A countdown timer shows time remaining.
- The HRV appears as a live number updating as data accumulates.
- The session runs for 3 or 5 minutes. You can end a reading early, but at least 3 minutes is required for an accurate reading while 5 minutes is the recommended standard.
- Sit or lie still. Avoid speaking, moving, changing posture or deep breathing during the reading. Any significant movement will affect the result.

### The HRV number

This section is a little technical. Skip it of you just want to get your HRV.

The HRV is calculated from RMSSD and SDNN.

- **RMSSD** (root mean square of successive RR differences) is the primary measure of parasympathetic (vagal) activity — the component most relevant to ANS recovery.
- **SDNN** (standard deviation of RR intervals) reflects total autonomic variability, including both parasympathetic and sympathetic contributions.

The index is computed as:

> **HRV Index = ln(RMSSD) × 15 × balanceFactor**

- **ln(RMSSD) × 15** is the core vagal tone signal, scaled to produce values in a practical range (roughly 0–100 for typical adults).
- **balanceFactor** (0–1) penalises sympathetic dominance. It is derived from the RMSSD/SDNN ratio: a healthy ANS produces relatively high RMSSD for its total variability. When the sympathetic system dominates — as it often does in dysautonomia — SDNN is elevated while RMSSD stays low, reducing the index.

### What to expect

A healthy adult at rest typically scores in the range of 40–70. With active dysautonomia, scores of 10–25 are common and are not cause for alarm — they reflect the current state of the ANS, not a permanent ceiling. Scores below 10 suggest significant sympathetic dominance or ANS depletion.

### Hardware requirement

Like the RFB resonance score, the HRV Index requires a sensor that exposes raw RR intervals. The **Polar H10** chest strap is strongly recommended. Optical wrist sensors and most sports watches that report only a rolling-averaged HR cannot be used for HRV readings.

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

**Recovery limits**
- *Max recovery period* — The total time allowed in 'Rest or pull back' before a forced heart rate Reset.
- *Max response lag* — How long HR is allowed to keep rising after entering 'Rest or pull back' before a heart rate Reset is forced. This specifically targets the delayed-recovery pattern.
- *Resets before warning* — How many heart rate Resets trigger the end-session advisory.

**Time limit and budget**

The time limit and the budget setting work together to define how you count your daily exercise allowance. The right choice depends on how well your HR is regulated.

When your HR is **dysregulated**, the appropriate response to 'Rest or pull back' is to stop completely — not to ease off, but to fully stop. You only accrue exercise credit while the app is in the active state. Set *Budget with* to **Active time**, and your limit will count only the time your HR is actually in the Continue activity zone.

When your HR is **regulated**, it becomes possible to stay active during 'Rest or pull back' by reducing effort slightly. In this case, meaningful exercise is happening whenever your HR is at or above your target minimum, regardless of which state the app has triggered. Set *Budget with* to **Target time**, and your limit will count any second your HR is at or above *Target min*, across all states.

- *Budget with* — Selects what counts toward your daily budget. **Active time** counts seconds in the Continue activity state. **Target time** counts seconds at or above Target Min HR, regardless of state.
- *Time limit* — Total budget allowed per session, in minutes. When reached, the app transitions to the heart rate Reset state. Set to 0 to disable. The session does not end automatically — you may choose to continue or finish.

**Target zone**
- *Target min / max* — The target zone is shown as a visual guide on the speedometer in all modes. This is a visual guide and is not used for calculations or transitions. In addition, when *Budget with* is set to Target time, any time your HR is at or above *Target min* counts toward your time limit, regardless of which state the app is in. 

**Alerts**
- *Vibration / Sound* — Intensity of the state-transition alerts (Off / Subtle / Intense).

**Resonance Frequency Breathing**
- See the dedicated RFB section above.

---

## ✨ Features

- **Direct Bluetooth Low Energy (BLE) connection** — Connects directly to standard BLE heart rate monitors (like Polar straps or watches) via the browser. Compatible with any device that implements the standard Heart Rate Measurement characteristic.
- **Raw RR interval support** — For devices that expose beat-to-beat RR data (such as the Polar H10), the app uses instantaneous heart rate on the HR graph rather than the sensor's rolling average. This higher-resolution signal is required for the RFB coherence score and HRV readings.
- **Sound and vibration alerts** — Configurable intensity on both, designed to be usable while active without watching the screen.
- **Progressive Web App (PWA)** — Installable directly to an Android home screen for fullscreen, app-like behaviour.
- **Multiple activity profiles** — Different threshold sets for different activities (e.g. walking, cycling, housework), switchable at session start.
- **Time limit** — Optional per-session cap on total time. When reached, the app transitions to the heart rate Reset state automatically.
- **Resonance Frequency Breathing** — Integrated breath pacer, sound and vibration guides, resonance scoring, and extended RFB phase during the Reset state. See dedicated section above.
- **HRV Reading** — A dedicated 3-minute resting measurement that produces a single HRV Index from RMSSD and SDNN. It is designed for consistent longitudinal tracking of ANS recovery. Requires a Polar H10 or equivalent RR-capable sensor.
- **Ectopic beat tracking** — Every session that uses an RR-capable sensor records the count and percentage of ectopic beats (PVCs, PACs). Reported in the session summary for all session types.
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
- **Session metadata** in the header: date, time, activity type, duration, average HR, etc
- **Legend** showing the states that occurred in the session

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

Any BLE heart rate monitor that implements the standard Heart Rate Measurement characteristic will work for basic pacing. For the **RFB resonance score**, **HRV Reading**, and higher-resolution HR graphing, a device that exposes raw RR intervals is required. The **Polar H10** chest strap is strongly recommended — it is the most widely used research-grade consumer device for this purpose and reliably exposes RR data via the standard BLE characteristic without requiring a proprietary app or API.

### Common Bluetooth Troubleshooting

Bluetooth LE can be finicky, especially on Android web apps. If the app connects but freezes without showing your heart rate, your phone and watch are likely in a "half-paired" state.

To fix this:
1. Close the watch or HR monitor's companion app on your phone (e.g. Polar Flow).
2. Open Bluetooth settings on your phone and unpair your watch or HR monitor there.
3. **Crucial step:** Go into your watch or HR monitor's own settings menu and delete/unpair your phone from there.
4. Try connecting again.

---

## ⚠️ Medical Disclaimer

*This application is provided for informational and educational purposes only. It is not a medical device, nor is it intended to diagnose, treat, cure, or prevent any disease. Always consult with a qualified healthcare provider before beginning any new exercise regimen, especially if you have dysautonomia or other cardiovascular or neurological conditions.*

---

## Author

**Chris Hilder** — [github.com/cj-hilder](https://github.com/cj-hilder)

## Licence

This project is licenced under the **Creative Commons Attribution 4.0 International (CC BY 4.0)** licence.

You are free to share and adapt this work for any purpose, including commercially, as long as you give appropriate credit to **Chris Hilder** and indicate if changes were made.

[![CC BY 4.0](https://licensebuttons.net/l/by/4.0/88x31.png)](https://creativecommons.org/licenses/by/4.0/)

Full licence text: [creativecommons.org/licenses/by/4.0](https://creativecommons.org/licenses/by/4.0/)
