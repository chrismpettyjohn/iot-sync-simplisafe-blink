import 'dotenv/config';
import assert from 'node:assert';

assert(process.env.GMAIL_EMAIL, 'GMAIL_EMAIL is required');
export const GMAIL_EMAIL: string = process.env.GMAIL_EMAIL;

assert(process.env.GMAIL_PASS, 'GMAIL_PASS is required');
export const GMAIL_PASS: string = process.env.GMAIL_PASS;

assert(process.env.BLINK_CLIENT, 'BLINK_CLIENT is required');
export const BLINK_CLIENT: string = process.env.BLINK_CLIENT;

assert(process.env.BLINK_EMAIL, 'BLINK_EMAIL is required');
export const BLINK_EMAIL: string = process.env.BLINK_EMAIL;

assert(process.env.BLINK_PASS, 'BLINK_PASS is required');
export const BLINK_PASS: string = process.env.BLINK_PASS;

assert(process.env.BLINK_NETWORK, 'BLINK_NETWORK is required');
export const BLINK_NETWORK: string = process.env.BLINK_NETWORK;

assert(process.env.BLINK_VERIFIED, 'BLINK_VERIFIED is required');
export const BLINK_VERIFIED: boolean = process.env.BLINK_VERIFIED.toLowerCase() === 'true';