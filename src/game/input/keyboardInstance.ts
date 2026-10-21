import { KeyboardInput } from './keyboard.ts';

/** The single keyboard instance shared by the controls hook, the frame loop (held keys) and the store. */
export const keyboard = new KeyboardInput();
keyboard.enabled = false;
