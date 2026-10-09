import { randomInt } from "crypto";

const ADJ = [
  "Neon", "Velvet", "Midnight", "Salty", "Disco", "Lazy", "Cosmic", "Fuzzy", "Golden", "Sneaky",
  "Spicy", "Moody", "Electric", "Chill", "Rusty", "Lucky", "Sleepy", "Wild", "Silver", "Smoky",
  "Jolly", "Witty", "Mellow", "Funky", "Quiet", "Brave", "Dizzy", "Snappy", "Breezy", "Cheeky",
];
const NOUN = [
  "Owl", "Fox", "Koala", "Pretzel", "Mango", "Comet", "Panda", "Otter", "Tiger", "Falcon",
  "Lemur", "Moth", "Walrus", "Pickle", "Samosa", "Cactus", "Llama", "Raven", "Pebble", "Badger",
  "Gecko", "Bison", "Yak", "Kiwi", "Peacock", "Chutney", "Jalebi", "Mongoose", "Parrot", "Squid",
];

export function randomHandle(): string {
  return `${ADJ[randomInt(ADJ.length)]} ${NOUN[randomInt(NOUN.length)]}`;
}
