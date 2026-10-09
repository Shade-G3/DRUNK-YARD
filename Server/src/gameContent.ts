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

export function pickN<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  const out: T[] = [];
  while (out.length < n) out.push(...copy.slice(0, n - out.length));
  return out;
}
