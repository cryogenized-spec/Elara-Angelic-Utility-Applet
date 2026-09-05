# UI Pass 8 — Composer Long-Press Voice Picker and Keyboard-Aware Chat

## Intent

This pass addresses the Android composer behavior shown in the latest reference screenshots:

- distribute the bottom composer controls evenly so the inline message editor gets more horizontal room;
- remove the separate always-visible voice-mode control from the composer row;
- make the microphone button the single voice entry point;
- start VTT recording on a normal tap/release;
- reserve a 300 ms press-and-hold for opening the `Raw`, `Polish`, and `Roleplay` picker, without starting a recording;
- keep the voice-mode picker local to the microphone control and keyboard accessible;
- make the composer consume layout space instead of overlapping the conversation;
- rely on the existing VisualViewport-driven shell sizing so Android IME reduction shrinks the conversation region above the composer;
- preserve latest-message stick-to-bottom behavior while the user is already at the end of the conversation, while still allowing normal manual scrolling.

## Interaction contract

A short microphone press starts VTT capture when the composer is idle. A press held for at least 300 ms opens the voice-mode menu and does not start capture. While VTT is active, the existing banner remains the authoritative control for stopping or cancelling the active operation.

The selected VTT mode is represented visually on the microphone control through its state and remains available for the next tap-to-record action.

## Layout contract

The inline composer has five controls: Markdown, attachment, text editor, microphone, and Send. The text editor receives the flexible middle column; the voice mode selector no longer consumes a separate grid column.

The composer is a non-overlapping flex sibling of the scrollable conversation surface. When the VisualViewport height decreases because the Android keyboard is visible, the shell contracts, the conversation gets less height, and its existing VisualViewport resize handler re-evaluates the end position.

## Validation targets

1. Short VTT tap still begins recording.
2. 300 ms long press opens the voice-mode picker and does not create a recording session.
3. Choosing Raw/Polish/Roleplay updates the microphone control and closes the picker.
4. Existing transcript insertion, transformation, cancellation, and empty-transcript behavior remain unchanged.
5. Composer controls remain aligned and the text editor gains the space previously used by the standalone mode selector.
6. Composer and conversation no longer overlap at reduced viewport heights.
