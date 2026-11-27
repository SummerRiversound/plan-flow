// Text from the model reaches state and the terminal only through clean(): no
// control character (so no escape sequence), no bidi override, no zero-width
// character, whitespace runs folded to one space.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]+/g
const INVISIBLE = /[​‌‎‏‪-‮⁦-⁩﻿]/g

export const clean = (text: string): string => text.replace(INVISIBLE, '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
