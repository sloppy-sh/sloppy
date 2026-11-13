// Every method a desk serves a headset beside its notes.

import { chatClosed, chatMethods } from './chat.js';
import { lookMethods } from './look.js';
import { registerServeMethods } from './methods.js';
import { speechMethods } from './speech.js';

registerServeMethods(speechMethods);
registerServeMethods(lookMethods);
registerServeMethods(chatMethods, chatClosed);
