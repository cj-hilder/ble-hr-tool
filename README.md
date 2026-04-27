# Manawa Pace v1.2
### MEASURE. PACE. IMPROVE.

**[Launch Manawa Pace here](https://manawapace.app)**

Manawa Pace helps you visualise what your heart is doing, pace exercise within heart rate thresholds you define, and practice resonance frequency breathing. 

It is built around the unstable HR patterns that can occur with autonomic nervous system dysregulation. People managing conditions such as POTS, Long COVID, ME/CFS, and Post-Concussion Syndrome may find it relevant, alongside anyone working with dysautonomia, post-exertional malaise, orthostatic intolerance, or autonomic recovery more generally.

Manawa Pace is intended to be used alongside your own judgement and your healthcare provider's guidance. It does not diagnose, monitor for, or treat any condition. It does not log symptoms or analyse data and offer advice. To use it effectively you need to be aware of your own diagnosis and symptoms, and understand how to pace your activity.

I built Manawa Pace to help manage my own post-concussion symptoms. I am not a clinician or researcher; this is a best-effort personal project that has worked well for me. It may or may not work for you. Nothing here should be taken as medical advice, and it is no substitute for working with a qualified healthcare provider who understands your condition.

[Quick Start Guide here](https://manawapace.app/quick_start_guide.html)

Manawa Pace is free, [open source software](https://github.com/cj-hilder/ble-hr-tool).

> **Note:** Wrist based (optical) heart rate sensors are not usually suitable for measuring heart rate in the presence of dysautonomia. They are misled by irregular beats, weak pulse strength, and arm movement. They can be significantly wrong. A chest strap sensor, e.g. Polar H10, is strongly recommended for HR based pacing with dysautonomia.
>
> **⚠️ Important:** This application is provided for informational and educational purposes only. It is not a medical device, nor is it intended to diagnose, treat, cure, or prevent any disease. Always consult with a qualified healthcare provider before beginning any new exercise regimen, especially if you have dysautonomia or other cardiovascular or neurological conditions. See full disclaimer at the end of this document.

---

## The Problem

Most commercial exercise apps and smart watches are built for healthy individuals with well-regulated autonomic nervous systems. They assume your heart rate will rise predictably when you exert yourself and drop predictably when you stop.

People with dysautonomia have a different experience. The autonomic nervous system (ANS) loses its normal control, producing three characteristic patterns:

- **HR rises faster and higher than the exertion warrants.**
- **HR recovery is delayed and is slower than normal.** Heart rate continues to go up for a time after stopping exertion, and then comes down slowly.
- **HR overshoots on the way down.** Heart rate drops below normal resting HR before stabilising.

Standard apps have no way to display or respond to any of these patterns. This app is built specifically to help visualise and respond to them.

In addition, this app provides features that may be useful beyond the point where your heart regulation has become normal:
1. An activity timer based on target heart rate to help you keep to a tightly controlled exercise programme.
2. A guided resonance frequency breathing practice. RFB has been studied as a method for influencing autonomic balance and is associated in the research literature with improvements in vagal tone over time.
3. HRV measurement to track daily readiness and longitudinal autonomic trends.

---

## The Pacing Approach

The app is built around two goals you may have:

1. **Maintaining or building activity within your tolerance.**
2. **Only exercise within the heart rate range you have established as appropriate for you.**

If these two goals are appropriate for you, using your own judgement and your healthcare provider's guidance, then this app provides information you can use when working towards those goals.

The app monitors your live heart rate via a Bluetooth HR monitor and alerts you when your heart rate crosses into or out of threshold zones, allowing you to follow strict pacing without having to watch the screen continuously.

Do not blindly follow the app. Be ready to adjust the settings, hit the reset button, or end the session if needed.

---

## Why heart rate pacing?

Rating of perceived exertion (RPE) — paying attention to how hard activity feels and adjusting accordingly — is increasingly recognised as the most effective pacing approach for both general fitness training and conditions like ME/CFS and post-exertional malaise. When it works well it is the simplest and most flexible method.

Heart rate pacing remains useful in situations where RPE is harder to apply, including:

- When cognitive symptoms (brain fog, difficulty concentrating) make self-assessment unreliable
- When other symptoms (pain, dizziness, lightheadedness, breathlessness, anxiety) dominate perceived effort independently of cardiovascular load
- When sustained low-intensity activity or cardiac dysregulation makes subjective effort an unreliable guide to cardiovascular strain
- When you are still building familiarity with your own perceived exertion signals
- When you simply prefer the objectivity of a measured number

Many people rely on HR until symptoms resolve or while building confidence with RPE and shift toward RPE over time.  Others use HR data as an objective check on subjective effort, or by personal preference. Manawa Pace is a tool for HR pacing.

---

## Two Recovery Contexts

How to use Manawa Pace depends on where you are in your health journey.

### If you have PEM or chronic fatigue

Your active threshold is a **ceiling, not a target**. With PEM/CFS, consistent compliance with the limit matters more than progression. Avoid raising the threshold based on a feeling of readiness — any change should be made cautiously and in consultation with your healthcare provider.

**Setting the threshold: the Workwell Foundation protocol**

The standard for determining a HR ceiling for ME/CFS pacing is a two-day Cardiopulmonary Exercise Test (CPET) administered by a specialist, which identifies the individual anaerobic threshold — the point at which the body shifts to less efficient energy production and PEM risk rises sharply. The [Workwell Foundation](https://workwellfoundation.org/pacing-with-a-heart-rate-monitor-to-minimize-post-exertional-malaise-pem-in-me-cfs-and-long-covid/), which pioneered this testing for ME/CFS, suggests that where CPET is unavailable a starting point of **resting HR + 15 bpm** can be used, based on a 7-day average of waking resting HR.

Clinical assessment is always preferable. The RHR + 15 starting point is a conservative, accessible alternative that errs on the side of caution rather than maximising activity.

Improvements in HR regulation typically appear as gradually shorter lag and recovery periods, fewer resets, and more time in the active state — all at a *fixed* threshold.

Once recovery lag times have become consistently short — typically less than 6 seconds — this is consistent with patterns sometimes observed in well-regulated autonomic function. However, if you continue to get symptoms of PEM you may wish to continue to use the app for threshold-based pacing.

### If you do not have PEM or chronic fatigue

Your active threshold can function as a **progressive target** — one that you raise gradually over time as HR regulation patterns improve, in consultation with your healthcare provider.

**The Buffalo Protocol — and why it needs adaptation**

The standard clinical approach for post-concussion autonomic rehabilitation is the [Buffalo Concussion Treadmill Test (BCTT)](https://pubmed.ncbi.nlm.nih.gov/24225521/), developed by Drs Leddy and Willer at the University at Buffalo. It identifies your individual symptom threshold through a graded treadmill test, then prescribes exercise at 80–90% of that threshold. This is a well-validated, evidence-based approach when the ANS is sufficiently stable to make the threshold meaningful.

The difficulty with dysautonomia-related HR instability is that the BCTT presupposes a reasonably stable and predictable HR response to exertion. When the heart is poorly regulated it is difficult to either establish, or exercise within, an appropriate threshold. 

A practical alternative is to **start with the Workwell RHR + 15 starting point as an initial ceiling**, and progressively raise the threshold as HR regulation and symptoms improve. HR regulation improvement may appear as shorter lag and recovery periods, fewer resets, and more time in the active state. Adjustments to the threshold should be made incrementally and in consultation with your healthcare provider, watching both HR regulation and symptoms.

This approach draws on the underlying logic of the Buffalo Protocol — sub-symptom threshold exercise as a context for autonomic adaptation — but replaces the clinical measurement with a conservative starting point and ongoing self-observation. It is not the Buffalo Protocol and has not been clinically validated as equivalent to it.

Once your recovery lag times have become consistently short, typically less than 6 seconds, it may become possible to follow the standard Buffalo Protocol with appropriate clinical guidance. This app continues to be useful by letting you switch the activity timer to target mode and follow a progressive programme of exercise increments.

---

## How the Pacing Logic Works

The app operates in four states.

### 🟢 Continue activity

Your heart rate is within the range you have configured — above the bradycardia threshold and below your active threshold. The app tracks total activity time to help you budget the amount of daily exertion.

If your heart rate drops *below* the bradycardia threshold during activity, the app forces a heart rate Reset. This is intended to flag the HR overshoot pattern that some people with dysautonomia experience, where an unexpectedly low reading during exertion may indicate the activity should be paused.

An optional **activity time limit** can be configured (see Settings). When your active time for the session reaches that limit, the app automatically triggers a heart rate reset as a reminder to end the session.

### 🟠 Rest or pull back

Your heart rate has hit your active threshold. Stop or significantly reduce activity. The app now tracks two things independently:

- **Response lag:** How many seconds pass before your HR actually starts falling. In typical autonomic function this happens within seconds; with dysautonomia it can be delayed. If the lag exceeds your configured limit, the app forces a heart rate Reset.
- **Total recovery time:** If your HR is falling but takes too long to reach your active threshold again, the app also forces a heart rate Reset.

Both are independent triggers based on the limits you have configured. The response lag trigger flags a delayed HR response; the maximum recovery period trigger flags a slow but ultimately incomplete recovery.

If your HR falls back below your active threshold quickly enough, you are returned to Continue activity.

### 🔴 / 🔵 Reset to resting HR

Your HR has exceeded your configured limits, or you have manually triggered a reset. The app now waits for your HR to return to your resting HR band and stay there for 15 consecutive seconds before returning you to Continue activity.

This may require you to completely stop and sit down.

**Session termination warning:** If you are forced into Reset several times in a single session, the app displays a prominent warning advising you to end the session.

**Resonance Frequency Breathing during reset**: If Resonance Frequency Breathing is enabled (see below), a breathing guide is displayed during the reset. See the dedicated section below.

### ⚫ Pause

You are currently in the active state but want to rest voluntarily — not because the app has detected a problem, but because you are choosing to rest. Pausing stops the activity timer without triggering a state change. When you are ready, tap Resume and continue the session.

---

## Settings

You must adjust the settings to suit your personal situation. Changes take effect immediately and are saved per activity type. The defaults correspond to an 80 BPM upper threshold protocol, which is a reasonable starting point for many people with post-concussion or ME/CFS-related dysautonomia, but individual variation is significant and you should expect some trial and error.

The key parameters and their purpose:

**Heart rate range**
- *Max HR* — Used to scale the speedometer and history graph. Use a calculator based on your age and sex (in dysautonomia, formula-derived estimates are generally more meaningful than a measured maximum). This is not used in any state transitions so it is not critical that it is your *correct* maximum HR; you might want to round it to the nearest 10.
- *Bradycardia threshold* — HR below this during activity triggers a heart rate Reset. Set it to a level that you consider notably below your normal resting range, in consultation with your healthcare provider if you are unsure. This is normally set to  alert you to potential heart rate recovery undershoot.

**Resting HR**
- *Resting HR* and *Bandwidth* — The target you must return to during a heart rate Reset, and the window around it. HR must stay within this band for 15 consecutive seconds for a heart rate Reset to complete.

**Active thresholds**
- *Upper threshold* — The ceiling for the Active state. If unsure, resting HR + 15 is a conservative starting point.
- *Lower threshold* — HR must fall below this to transition from 'Rest or pull back' to 'Active'. Usually set just below the upper threshold.

**Target zone**
- *Target min / max* — The target zone is shown as a visual guide on the speedometer in all modes. This is a visual guide and is not used for calculations or transitions except when *Time limit type* is set to Target time. In that case any time your HR is at or above *Target min* counts toward your time limit, regardless of which state the app is in. 

**Time limits**
The time limit type controls what counts toward your daily exercise allowance. Two options are available:

- **Active time** counts only time spent in *Continue Activity*. With this setting, time during *Rest or pull back* does not count toward the limit. This is the more conservative choice and is appropriate when reaching *Rest or pull back* should result in fully stopping activity.
- **Target time** counts any time your HR is at or above *Target min*, regardless of state. With this setting, time spent reducing effort rather than fully stopping during *Rest or pull back* continues to count toward the limit, provided HR remains at or above the target. This may be appropriate when partial effort reduction (rather than full stop) is suitable for your situation.

Which setting is right for you depends on your own situation and any guidance from your healthcare provider. As a general orientation: *Active time* tends to suit contexts where HR is poorly regulated and stopping fully is the safer response; *Target time* tends to suit contexts where HR is well regulated and continued reduced-effort activity is appropriate.

- *Time limit type* — Selects what counts toward your daily budget. **Active time** counts time in the *Continue activity* state. **Target time** counts time at or above *Target min* HR, regardless of state.
- *Time limit mins* — Total number of minutes allowed per session. When reached, the app transitions to the heart rate Reset state to remind you to end the session. Set to 0 to disable. The session does not end automatically — you may choose to continue or finish.

**Recovery limits**
Adjust these based on how long it typically takes your heart to respond when you stop activity. Tuning these settings is a personal trade-off between exercise volume and symptom load; adjust based on your own observation, your tolerance, and any guidance from your healthcare provider.
- *Max recovery period* — The total time allowed in 'Rest or pull back' before a forced heart rate Reset.
- *Max response lag* — How long HR is allowed to keep rising after entering 'Rest or pull back' before a heart rate Reset is forced. 
- *Resets before warning* — How many heart rate Resets trigger the end-session advisory.

**Alerts**
- *Vibration / Sound* — Intensity of the state-transition alerts (Off / Subtle / Intense).

**Resonance Frequency Breathing**
- See the dedicated RFB section below.

---

## The Live HR Graph

Your heart rate is graphed continuously on screen. The display shows the last 90 secs of data. The graph begins as soon as you connect to your HR monitor — before any session starts. This pre-session data is shown in grey, giving you a baseline view of your resting HR and any spontaneous variability before you begin.

When connected to a sensor that exposes raw beat-to-beat RR intervals, such as the Polar H10, this graph shows **unsmoothed, instantaneous heart rate**. This is not the smoothed heart rate graph that most fitness apps show. It shows every little variation and will be quite jagged, especially when you are at rest or low levels of exertion. You will see involuntary sighs as smooth little dips and ectopic beats as vertical spikes. The graph is intended to display your cardiac data rather than hide it; minor variations and occasional ectopic spikes are commonly observed in healthy hearts, but anything that worries you is worth raising with a clinician.

>**Spontaneous sighs:** During light aerobic activity you may notice involuntary sighs — deeper breaths that appear as smooth little dips on the HR graph — occurring roughly every 2–5 minutes. This is a normal physiological reflex. These normally disappear around your anaerobic threshold. Observing the presence or absence of involuntary sighs can sometimes be a useful indicator that helps with establishing your anaerobic threshold. 

>**Ectopic heart beats:**  If any are detected they will be included in the session summary. Ectopics are beats that fire outside the normal cardiac rhythm. There are two common types:
>
>- **PVC (premature ventricular contraction):** A beat that fires early. On the graph it appears as a **sharp spike upward, immediately followed by a smaller spike downward**. 
>- **PAC (premature atrial contraction):** A beat that fires early and resets your cardiac rhythm. On the graph it appears as a **spike upward with no corresponding downward spike**.
>
>Not everything that looks like an ectopic beat is counted. Only beats that are both sufficiently premature and match the PVC or PAC pattern within tight tolerances are included. Runs, couplets, and triplets are not detected. Additionally, sometimes sensor noise can be mistakenly counted as an ectopic beat. The count is provided because you might find it interesting or informative, but it is no substitute for a clinical assessment.
>
>As a general rule of thumb often cited in cardiology literature, an ectopic burden of under 1% of total beats is generally considered negligible, and a modest number of ectopic beats per day is normal for a healthy heart. These figures vary across sources and populations and are presented here for general orientation rather than as a clinical guideline. Ectopic beats can fluctuate widely based on sleep quality, caffeine intake, and stress. A sustained downwards trend over time may be of interest as one of several markers of autonomic state, but observing a trend is made difficult by the comparatively small numbers of ectopic beats. Trends are only meaningful when comparing similar session types under similar conditions. If you regularly see more than around 5%, a significant change in rate above 1%, or if the beats are accompanied by dizziness, fainting, a palpitation sensation lasting more than one beat, or an experience of sustained skipping, it is worth raising with a clinician.

---

## Resonance Frequency Breathing (RFB)

Resonance Frequency Breathing is a biofeedback technique. RFB has been studied extensively (notably by Lehrer and Gevirtz and colleagues) as a method for influencing autonomic balance, and is associated in the research literature with increases in vagal tone over time with regular practice.

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
- **During heart rate Reset, once your HR has returned to your resting HR**, the app enters an extended RFB phase — shown as a countdown timer — before returning you to Continue activity. The default is 2 minutes. This promotes staying in the resonance breathing state after the HR has settled, extending the breathing practice before returning to exertion.

### Resonance score

If you are using a **Polar H10** chest strap (or any sensor that exposes raw RR intervals via the Bluetooth Heart Rate Measurement characteristic), the app can calculate a **live resonance score**. This is a combination of wave coherence, amplitude, frequency stability, and phase lag. It takes more than 60 seconds to gather enough data to calculate a score

>Amplitudes below 7.5 bpm receive a proportional penalty, reflecting the established association between reduced amplitude and impaired cardiac vagal tone. (7.5 bpm = 50% of the Hirsch & Bishop (1981) healthy adult floor of 15 bpm.)

Once enough data has been gathered, the score appears as a number and a star rating beneath the state description. 

| Rating | Score | Resonance |
| :--- | :--- | :--- |
| ☆☆☆ | < 30 | Very Low |
| ★☆☆ | ≥ 30 | Low |
| ★★☆ | ≥ 45 | Moderate |
| ★★★ | ≥ 65 | Strong |

**A note on the score:** The score is a feedback signal, not a target to chase. Stress about the number tends to lower it. With practice, healthy nervous systems are commonly capable of scores above 65 (three stars). With dysautonomia, scores in the 20–30 range early on are common and a reasonable starting point. What is informative longitudinally is stability and trend over weeks rather than any individual session score. A low score, or a flat HR line, is commonly observed when the ANS is fatigued or depleted. Scores often rise over time as the practice develops.

Changes in the score during a session or during the day may be a useful cue to stop for the day, particularly if you have achieved a stable score that then declines during the session or over the day.

Tracking your star rating and score over weeks may be of interest as one of several markers of autonomic state. However, the primary value of resonance frequency breathing is the practice itself; the score is intended to help you improve your practice.

### Finding your personal resonance frequency

Each person has a slightly different resonance frequency. Most people find theirs between 5 and 6 breaths per minute; some find theirs slower with practice.

Try a few paces across consecutive sessions and compare your average resonance score:

1. Set *Breaths per minute* to 6.0 with *Inhale percentage* at 50%. Run a full RFB session and note your score.
2. Next session, try 5.5 bpm.
3. The session after, try 5.0 bpm.

Settle on the bpm value that produces your highest score while feeling the most effortless and natural.

**Asymmetric breathing.** Some practitioners find that a longer exhale than inhale produces a stronger response. Once you've found your bpm, try lowering the inhale percentage to 40 — this gives you a longer exhale relative to your inhale.

**Going slower than 5 bpm.** A small number of people find their resonance frequency below 5 breaths per minute. If you want to explore this, do so with care:

- Don't increase tidal volume to compensate. Slow breathing combined with deeper breaths leads to over-breathing and CO₂ depletion, which causes lightheadedness, tingling, or feeling spacey. The breathing should still feel light.
- Stop or step back if you feel strained, anxious, or notice persistent air hunger that doesn't settle within the first minute or two of practice.
- If you have orthostatic intolerance, very slow breathing can transiently affect blood pressure. Practice seated or lying down rather than standing.
- If your score *drops* as you go slower, that is the signal to step back. Resonance frequency is the rate at which your score is highest, not the slowest rate you can sustain.

Your resonance frequency is generally fairly stable, but can shift gradually over time — especially during periods of autonomic change or recovery. It's worth re-checking periodically, particularly if your scores start to drift downwards.

### RFB Settings

- **Enable RFB** — Master toggle. When off, the Reset state behaves as a stop activity state (red dot, no breath pacer).
- **Breaths per minute** — Slow breathing pace, typically 5–6 bpm. Adjustable in 0.1 bpm steps.
- **Inhale percentage** — What fraction of each breath is the inhale. 50% is symmetric. Lower values give a proportionally longer exhale.
- **Inhale / exhale** — Display only. Shows the seconds per half-breath calculated from the bpm and inhale percentage.
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

> **Note:** You may feel a mild sensation of "air hunger" — a slight urge to take a bigger breath. This is generally considered a normal sensation during slow breathing practice and not a cause for concern at mild levels. Tolerate it gently. Never push into discomfort or panic.

### Knowing When to Stop

If your nervous system is currently deconditioned, it will fatigue quickly. Pushing through that fatigue may backfire and produce a stress response. Consider stopping the RFB session if you notice any of the following:

**The resonance crash.** If your score has been sitting in the ★☆☆ or ★★☆ range and then suddenly drops to ☆☆☆ or near-zero, this may suggest your autonomic system is tiring — analogous to muscular fatigue. A reasonable response is to stop for the day.

**Brain fog or frustration.** Paced breathing requires sustained focus. If your mind is wandering, you feel agitated, or you are struggling to hold the rhythm, your cognitive battery is empty.

**Physical red flags.** If mild air hunger turns into a racing heart, dizziness, or anxiety, stop RFB immediately and let your breathing return to its natural pattern.

Two minutes of comfortable, high-quality breathing is vastly superior to ten minutes of struggling. Stop while you are ahead. The goal is not duration — it is quality, and a consistently gentle practice will build capacity far more reliably than straining for longer sessions.

---

## HRV Reading

An HRV Reading gives you a single number that summarises your heart rate variability. It is useful as a longitudinal recovery signal, provided you take readings under similar circumstances. 

Consistent morning readings, taken at the same time each day — before getting up or after a few minutes of quiet rest — will give the most comparable longitudinal data. There is no 'correct' HRV that you should aim for. HRV scores often rise over time as autonomic regulation patterns improve.

Select **"HRV Reading"** from the activity drop-down menu to start a new reading.

Wait until your heart rate has settled to your resting heart rate before starting. The displayed HRV number will change during the session, converging on the final value. If it jumps up and down by more than a few points you may have started the reading before your heart rate has settled.

### During the session

- **The status dot turns purple** for the duration of the reading.
- A countdown timer shows time remaining.
- The HRV appears as a live number updating as data accumulates.
- The session runs for 3 or 5 minutes. You can end a reading early, but at least 3 minutes is required for an accurate reading while 5 minutes is the recommended standard.
- Sit or lie still. Avoid speaking, moving, changing posture or deep breathing during the reading. Any significant movement will affect the result.

### The HRV number

This section is a little technical. Skip it if you just want to get your HRV.

The HRV is calculated from RMSSD and SDNN.

- **RMSSD** (root mean square of successive RR differences) is the primary measure of parasympathetic (vagal) activity — the component most relevant to ANS recovery.
- **SDNN** (standard deviation of RR intervals) reflects total autonomic variability, including both parasympathetic and sympathetic contributions.

The index is computed as:

> **HRV Index = ln(RMSSD) × 15.3 × balanceFactor**

- **ln(RMSSD) × 15.3** is the core vagal tone signal, scaled to produce values in a practical range.
- **balanceFactor** (0–1) adjusts for sympathetic dominance. It is derived from the RMSSD/SDNN ratio: a healthy ANS produces relatively high RMSSD for its total variability. Sympathetic dominance — a pattern often described in the dysautonomia literature — produces elevated SDNN with low RMSSD, which reduces the index.

### What to expect

For broad orientation: HRV index scores broadly comparable to those produced by other consumer HRV platforms tend to fall in the 40–70 range for healthy adults at rest. With active dysautonomia, scores in the 10–25 range are commonly reported and are not necessarily concerning on their own — they reflect a current state rather than a permanent ceiling. Lower scores tend to be associated with sympathetic dominance or fatigue states. These ranges are general orientations rather than clinical thresholds; what matters longitudinally is your own trend over time, which is more informative than any single reading.

Manawa Pace HRV scores use the same underlying ln(RMSSD) scaling as EliteHRV and Visible HRV, so scores are on a broadly comparable scale. Exact correspondence between platforms will vary because of differences in windowing, artifact handling, and scaling choices.

### Hardware requirement

Like the RFB resonance score, the HRV Index requires a sensor that exposes raw RR intervals. The **Polar H10** chest strap is strongly recommended. Optical wrist sensors and most sports watches that report only a rolling-averaged HR cannot be used for HRV readings.

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

## ✨ Features

- **Direct Bluetooth Low Energy (BLE) connection** — Connects directly to standard BLE heart rate monitors (like Polar straps or watches) via the browser. Compatible with any device that implements the standard Heart Rate Measurement characteristic.
- **Raw RR interval support** — For devices that expose beat-to-beat RR data (such as the Polar H10), the app uses instantaneous heart rate on the HR graph rather than the sensor's rolling average. This higher-resolution signal is required for the RFB coherence score and HRV readings.
- **Sound and vibration alerts** — Configurable intensity on both, designed to be usable while active without watching the screen.
- **Progressive Web App (PWA)** — Installable directly to an Android home screen for fullscreen, app-like behaviour.
- **Multiple activity profiles** — Different threshold sets for different activities (e.g. walking, cycling, housework), switchable at session start.
- **Time limit** — Optional per-session cap on total time. When reached, the app transitions to the heart rate Reset state automatically.
- **Resonance Frequency Breathing** — Integrated breath pacer, sound and vibration guides, resonance scoring, and extended RFB phase during the Reset state. See dedicated section above.
- **HRV Reading** — A dedicated 3-5 minute resting measurement that produces a single HRV Index from RMSSD and SDNN. It is designed for consistent longitudinal tracking of ANS recovery. Requires a Polar H10 or equivalent RR-capable sensor.
- **Ectopic beat tracking** — Every session that uses an RR-capable sensor records the count and percentage of ectopic beats (PVCs, PACs). Reported in the session summary for all session types.
- **Session HR recording and graph export** — Every session records 1Hz heart rate data alongside state transitions. Saved sessions can be exported as a landscape A4 PDF graph showing HR over time with colour-coded state background bands, axes, and a resting HR reference line.
- **Session history and trend graphs** — Each session can be saved with notes. History graphs allow you to track recovery metrics over time.
- **Response lag and HR overshoot tracking** — Per-session statistics on recovery lag, HR peak during rest, and active/recovery time ratios.
- **Minimalist design** — Large, accessible UI with clear visualisation of live heart rate and state.

---

## Requirements & Usage

Because this app uses the **Web Bluetooth API**, it requires a compatible browser and operating system.

- **Supported:** Android devices running Google Chrome; Chrome on Desktop (Windows/Mac).
- **Not supported:** iOS devices (Apple Safari does not currently support Web Bluetooth natively).

### Setup Instructions

1. Open the app on your Android device: **[manawapace.app](https://manawapace.app)**
2. Tap the browser menu (three dots) and select **"Add to Home screen"** or **"Install App"**.
3. Launch the app from your home screen.
4. Put your heart rate monitor into pairing/broadcasting mode (e.g. on a Polar watch, select a workout and tap the gear icon to enable "Share HR with other devices").
5. Tap **Connect to HR monitor** and select your device from the browser popup.
6. Set Unrestricted Battery Use: (optional) This will prevent your screen from dimming during a session. Detailed instructions [here](https://manawapace.app/battery_settings_guide.html)

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

## How to contribute

Send your feedback, ideas, or bug reports to **chris at manawapace.app**. If you have been using the app and have detailed experience to share, that is especially welcome.

> **Please note:** This is not a channel for medical concerns. If you are experiencing symptoms or believe you may be having a medical event, contact your healthcare provider or local emergency services. Reports about the app's behaviour are welcome; reports about your health should go to a clinician.

Please include:
- What activity or session type you were using
- What you expected to happen or what you needed
- What actually happened
- Your sensor (e.g. Polar H10, other chest strap, watch)
- Your device and Android version if relevant

### A note on scope

This is a personal project maintained by one person. There is no guarantee that any given suggestion will be implemented, or on any particular timeline. However, if you are finding this app useful and have ideas that could make it better I will happily do what I can to improve it.

---

## ⚠️ Medical Disclaimer

*This application is provided for informational and educational purposes only. It is not a medical device, nor is it intended to diagnose, treat, cure, or prevent any disease. Always consult with a qualified healthcare provider before beginning any new exercise regimen, especially if you have dysautonomia or other cardiovascular or neurological conditions.*

---

## Author

**Chris Hilder** — [github.com/cj-hilder](https://github.com/cj-hilder) ✉️ chris at manawapace.app 

## Licence

This project is dual-licensed:

- **Source code** is licenced under the **Apache License, Version 2.0**.
- **Documentation, prose content, and other non-code material** (this README, the quick start guide, and similar) is licenced under the **Creative Commons Attribution 4.0 International (CC BY 4.0)** licence.

In both cases, you are free to share and adapt the work for any purpose, including commercially, as long as you give appropriate credit to **Chris Hilder** and indicate if changes were made. Apache 2.0 additionally requires that modified source files carry a notice stating that they were modified, and that any redistribution preserves the licence text and any NOTICE file.

Both licences include explicit disclaimers of warranty and limitations of liability. The software and documentation are provided "as is", without warranty of any kind, express or implied, including warranties of merchantability, fitness for a particular purpose, and non-infringement. To the maximum extent permitted by applicable law, the author is not liable for any damages, claims, or other liabilities arising from use of the software or documentation, whether in contract, tort, or otherwise. Use is at your own risk and remains your responsibility.

Full licence texts:
- Apache 2.0: [apache.org/licenses/LICENSE-2.0](https://www.apache.org/licenses/LICENSE-2.0) — also included in the project as `LICENSE`
- CC BY 4.0: [creativecommons.org/licenses/by/4.0](https://creativecommons.org/licenses/by/4.0/) — also included in the project as `LICENSE-DOCS`

**A note on the project name:** "Manawa Pace" is the name of this project, used by Chris Hilder. Apache 2.0 Section 6 does not grant permission to use this name, or related branding, in derivative works or to suggest endorsement. Forks and derivatives are welcome under the licence, but please choose a different name for your fork. Mentioning "Manawa Pace" in attribution (e.g. "based on Manawa Pace by Chris Hilder") is the intended use and is fine.

[![Apache 2.0](https://img.shields.io/badge/license--code-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0) [![CC BY 4.0](https://licensebuttons.net/l/by/4.0/88x31.png)](https://creativecommons.org/licenses/by/4.0/)
