import { randomInt } from "crypto";
/**
 * Prompt decks. Kept PG-13 on purpose: no prompt rewards actually drinking
 * ("take a shot if…") — that is a safety + app-store red line.
 */

export const THIS_OR_THAT: [string, string][] = [
  ["Chai", "Coffee"], ["Mountains", "Beaches"], ["Night owl", "Early bird"], ["Biryani", "Pizza"],
  ["Text", "Call"], ["Dogs", "Cats"], ["Netflix", "Going out"], ["Sweet", "Spicy"],
  ["Road trip", "Flight"], ["Bollywood", "Hollywood"], ["Sunrise", "Sunset"], ["Gym", "Sleep in"],
  ["Momos", "Golgappe"], ["Rain", "Sunshine"], ["Old songs", "New songs"], ["City", "Village"],
  ["Books", "Podcasts"], ["Instagram", "YouTube"], ["Cricket", "Football"], ["Plan everything", "Wing it"],
  ["Street food", "Fine dining"], ["Winter", "Summer"], ["Android", "iPhone"], ["Introvert", "Extrovert"],
];

export const WOULD_YOU_RATHER: [string, string][] = [
  ["Always be 10 minutes late", "Always be 20 minutes early"],
  ["Know every language", "Play every instrument"],
  ["Lose your phone for a week", "Lose your wallet for a week"],
  ["Live without music", "Live without movies"],
  ["Be famous for something silly", "Be unknown for something great"],
  ["Have a rewind button", "Have a pause button"],
  ["Eat only Maggi for a month", "Never eat Maggi again"],
  ["Read minds", "Be invisible"],
  ["Go 10 years into the past", "Go 10 years into the future"],
  ["Have unlimited flights", "Have unlimited food"],
  ["Never use social media again", "Never watch TV again"],
  ["Sing every time you speak", "Dance every time you walk"],
  ["Be the funniest person in the room", "Be the smartest"],
  ["Live in a treehouse", "Live on a houseboat"],
  ["Have your search history leaked", "Have your chats leaked"],
  ["Work your dream job for low pay", "A boring job for huge pay"],
];

export const MOST_LIKELY: string[] = [
  "...text their ex before the night ends?",
  "...become famous on the internet by accident?",
  "...cry during a cartoon movie?",
  "...forget their own birthday?",
  "...survive a zombie apocalypse?",
  "...start a business that actually works?",
  "...fall asleep at a party?",
  "...get lost with Google Maps open?",
  "...talk their way out of a traffic challan?",
  "...move to another country on a whim?",
  "...reply to a message 3 days later?",
  "...win a dance battle?",
  "...have 500 unread notifications right now?",
  "...adopt five pets?",
  "...become a motivational speaker?",
  "...laugh at the worst possible moment?",
  "...be secretly rich?",
  "...ghost this call first?",
];

export const NEVER_HAVE_I_EVER: string[] = [
  "Never have I ever stalked an ex's profile at 2 AM.",
  "Never have I ever pretended to be busy to skip a plan.",
  "Never have I ever lied about my age.",
  "Never have I ever sent a text to the wrong person.",
  "Never have I ever cried at a wedding.",
  "Never have I ever fallen asleep in class or a meeting.",
  "Never have I ever faked a call to escape a conversation.",
  "Never have I ever re-gifted a present.",
  "Never have I ever sung loudly in the car alone.",
  "Never have I ever binged a whole series in one day.",
  "Never have I ever had a crush on a teacher.",
  "Never have I ever been on a blind date.",
  "Never have I ever eaten food that fell on the floor.",
  "Never have I ever laughed so hard I cried.",
  "Never have I ever ghosted someone.",
  "Never have I ever gone a whole day without my phone.",
  "Never have I ever lied in a game like this.",
];

export const RED_GREEN: string[] = [
  "They reply to every text within a minute.",
  "They still have their ex in their close friends.",
  "They plan the whole date, down to the minute.",
  "They're rude to the waiter but sweet to you.",
  "They know your chai order by the second date.",
  "They share their location with you on day one.",
  "They have zero social media.",
  "They split the bill to the exact rupee.",
  "They call their mom every day.",
  "They want to meet your friends early on.",
  "They never post you online.",
  "They send you memes instead of good morning texts.",
  "They remember small details you mentioned once.",
  "They get jealous of your best friend.",
  "They're always 'too busy' but online on Instagram.",
  "They cook for you on the first date at home.",
];

export const TRUTHS: string[] = [
  "What's the most embarrassing thing on your phone right now?",
  "What's a small thing that instantly makes your day?",
  "What's the worst date you've been on?",
  "What's one thing you'd never tell your parents?",
  "Who in your life do you miss the most right now?",
  "What's your most irrational fear?",
  "What's the last lie you told?",
  "What's a habit you're secretly proud of?",
  "What's the best compliment you've ever received?",
  "What song do you play when nobody's around?",
];

export const DARES: string[] = [
  "Do your best impression of someone in this room for 15 seconds.",
  "Speak in an accent until your next turn.",
  "Show the last photo in your gallery (if it's safe!).",
  "Do 10 squats on camera right now.",
  "Sing the chorus of the last song you listened to.",
  "Let the room pick your new anonymous name.",
  "Tell a joke. If nobody laughs, tell another one.",
  "Talk like a news anchor until your next turn.",
  "Do a dramatic slow-motion walk across your room.",
  "Describe your day using only movie titles.",
];

/** Spicy pack: only in Flirty rooms, still no nudity/sexual acts (moderation + store policy). */
export const SPICY_TRUTHS: string[] = [
  "What's your biggest turn-on in a conversation?",
  "What's the boldest pickup line you've used (or heard)?",
  "Who here would you go on a date with, and where?",
  "What's your idea of a perfect first kiss?",
  "What's the most romantic thing you've done for someone?",
  "What's your type, in three words?",
];

export const SPICY_DARES: string[] = [
  "Give the person on your right your best pickup line.",
  "Describe your dream date in 20 seconds.",
  "Wink at the camera like you mean it.",
  "Compliment everyone in the room in one sentence each.",
  "Serenade the room with one romantic line from a song.",
];

/** Crypto-grade shuffle — card games must not be predictable from Math.random. */
export function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function pickN<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  const out: T[] = [];
  while (out.length < n) out.push(...copy.slice(0, n - out.length));
  return out;
}

// ── Guess games (Instagram-style) ────────────────────────────────────────────
/** [answer, ...aliases] — matching ignores case, spaces, articles and a trailing "s". */
export const ANIMALS: string[][] = [
  ["elephant"], ["giraffe"], ["penguin"], ["kangaroo"], ["octopus"], ["cow"], ["camel"], ["peacock"],
  ["shark"], ["panda"], ["tiger"], ["monkey"], ["owl"], ["crocodile", "croc"], ["dolphin"], ["sloth"],
  ["flamingo"], ["frog"], ["horse"], ["snake"], ["lion"], ["zebra"], ["bat"], ["parrot"], ["goat"],
];

export const OBJECTS: string[][] = [
  ["toothbrush"], ["umbrella"], ["pressure cooker", "cooker"], ["remote", "remote control", "tv remote"],
  ["phone charger", "charger"], ["pillow"], ["sunglasses", "shades"], ["mirror"], ["scissors"],
  ["mosquito bat", "mosquito racket"], ["chair"], ["key", "keys"], ["wallet"], ["headphones", "earphones"],
  ["candle"], ["ladder"], ["bucket"], ["laptop"], ["shoe", "shoes"], ["clock", "alarm clock"],
  ["helmet"], ["pizza"], ["spoon"], ["toothpaste"], ["ceiling fan", "fan"],
];

/** [emoji clue, answer, ...aliases] */
export const EMOJI_PUZZLES: string[][] = [
  ["👨‍🎓👨‍🎓👨‍🎓", "3 Idiots", "three idiots"],
  ["🤼‍♀️👧👧👨", "Dangal"],
  ["🏑🇮🇳👨‍🏫", "Chak De India", "chak de"],
  ["🏃‍♂️🏃‍♂️🏃‍♂️🇮🇳", "Bhaag Milkha Bhaag"],
  ["🚀🔴👩‍🔬", "Mission Mangal"],
  ["🦸‍♂️🇮🇳🧥", "Krrish", "krish"],
  ["🎸🤘", "Rock On", "rock on!!"],
  ["🦁👑", "The Lion King", "lion king"],
  ["🚢🧊💔", "Titanic"],
  ["🦖🏝️", "Jurassic Park"],
  ["🧞‍♂️🪔", "Aladdin"],
  ["🐼🥋", "Kung Fu Panda"],
  ["👽📞🏠", "E.T.", "et"],
  ["🐀👨‍🍳", "Ratatouille"],
  ["🍫🏭", "Charlie and the Chocolate Factory", "chocolate factory"],
  ["🧊👸❄️", "Frozen"],
  ["🦇🧔🌃", "Batman", "the dark knight", "dark knight"],
  ["🚗💨🔥", "Fast and Furious", "fast & furious", "the fast and the furious"],
];

export function normalizeGuess(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/^(a|an|the) /, "")
    .replace(/\s+/g, "")
    .replace(/s$/, "");
}

export function matches(guess: string, accepted: string[]): boolean {
  const g = normalizeGuess(guess);
  return !!g && accepted.some((a) => normalizeGuess(a) === g);
}

// ── Catch the Imposter: [everyone's word, the undercover's word] ─────────────
export const WORD_PAIRS: [string, string][] = [
  ["Goa", "Manali"], ["Chai", "Coffee"], ["Samosa", "Kachori"], ["Cricket", "Football"], ["Biryani", "Pulao"],
  ["Shah Rukh Khan", "Salman Khan"], ["Instagram", "Snapchat"], ["Metro", "Bus"], ["Wedding", "Birthday party"],
  ["Diwali", "Holi"], ["Pani puri", "Bhel puri"], ["Netflix", "YouTube"], ["Beach", "Swimming pool"],
  ["Gym", "Yoga"], ["Dog", "Cat"], ["Pizza", "Burger"], ["Mumbai", "Delhi"], ["Exam", "Interview"],
  ["Auto rickshaw", "Taxi"], ["Rain", "Snow"], ["Guitar", "Piano"], ["WhatsApp", "Telegram"], ["Maggi", "Pasta"],
  ["Ex", "Crush"], ["Hangover", "Jet lag"], ["Mango", "Banana"], ["Hostel", "PG"], ["Tinder", "Shaadi.com"],
  ["Beer", "Whisky"], ["Dosa", "Uttapam"], ["Harry Potter", "Lord of the Rings"], ["Train", "Flight"],
  ["Moon", "Sun"], ["Doctor", "Nurse"], ["Lipstick", "Nail paint"], ["Office", "College"],
];
