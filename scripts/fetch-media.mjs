#!/usr/bin/env node
/**
 * One-shot helper to store Wikimedia stills under media/.
 * The running app never calls this.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = "ExitTrace/1.0 (https://github.com/areveur51/ExitTrace; media archive)";
const PEOPLE = path.join(ROOT, "media", "people");
const DOGS = path.join(ROOT, "media", "dog-comms");

const PEOPLE_PAGES = {
  "james-comey.jpg": "James Comey",
  "rex-tillerson.jpg": "Rex Tillerson",
  "andrew-mccabe.jpg": "Andrew McCabe",
  "john-bolton.jpg": "John Bolton",
  "steve-easterbrook.jpg": "Steve Easterbrook",
  "chris-cuomo.jpg": "Chris Cuomo",
  "jeff-zucker.jpg": "Jeff Zucker",
  "bob-chapek.jpg": "Bob Chapek",
  "tucker-carlson.jpg": "Tucker Carlson",
  "sam-altman.jpg": "Sam Altman",
  "les-moonves.jpg": "Leslie Moonves",
  "matt-lauer.jpg": "Matt Lauer",
  "travis-kalanick.jpg": "Travis Kalanick",
  "sean-spicer.jpg": "Sean Spicer",
  "jeff-sessions.jpg": "Jeff Sessions",
  "jim-mattis.jpg": "Jim Mattis",
  "theresa-may.jpg": "Theresa May",
  "andrew-cuomo.jpg": "Andrew Cuomo",
  "boris-johnson.jpg": "Boris Johnson",
  "liz-truss.jpg": "Liz Truss",
  "jacinda-ardern.jpg": "Jacinda Ardern",
  "nicola-sturgeon.jpg": "Nicola Sturgeon",
  "liz-magill.jpg": "Liz Magill",
  "claudine-gay.jpg": "Claudine Gay",
  "reince-priebus.jpg": "Reince Priebus",
  "john-kelly.jpg": "John F. Kelly",
  "kirstjen-nielsen.jpg": "Kirstjen Nielsen",
  "betsy-devos.jpg": "Betsy DeVos",
  "elaine-chao.jpg": "Elaine Chao",
  "nancy-pelosi.jpg": "Nancy Pelosi",
  "kevin-mccarthy.jpg": "Kevin McCarthy",
  "sebastian-kurz.jpg": "Sebastian Kurz",
  "yoshihide-suga.jpg": "Yoshihide Suga",
  "giuseppe-conte.jpg": "Giuseppe Conte",
  "scott-morrison.jpg": "Scott Morrison",
  "justin-trudeau.jpg": "Justin Trudeau",
  "mary-tyler-moore.jpg": "Mary Tyler Moore",
  "chuck-berry.jpg": "Chuck Berry",
  "aretha-franklin.jpg": "Aretha Franklin",
  "stan-lee.jpg": "Stan Lee",
  "kobe-bryant.jpg": "Kobe Bryant",
  "chadwick-boseman.jpg": "Chadwick Boseman",
  "betty-white.jpg": "Betty White",
  "sidney-poitier.jpg": "Sidney Poitier",
  "pele.jpg": "Pelé",
  "tina-turner.jpg": "Tina Turner",
  "matthew-perry.jpg": "Matthew Perry",
  "james-earl-jones.jpg": "James Earl Jones",
  "liu-xiaobo.jpg": "Liu Xiaobo",
  "john-mccain.jpg": "John McCain",
  "george-hw-bush.jpg": "George H. W. Bush",
  "john-lewis.jpg": "John Lewis",
  "ruth-bader-ginsburg.jpg": "Ruth Bader Ginsburg",
  "colin-powell.jpg": "Colin Powell",
  "madeleine-albright.jpg": "Madeleine Albright",
  "elizabeth-ii.jpg": "Elizabeth II",
  "mikhail-gorbachev.jpg": "Mikhail Gorbachev",
  "henry-kissinger.jpg": "Henry Kissinger",
  "dianne-feinstein.jpg": "Dianne Feinstein",
  "jimmy-carter.jpg": "Jimmy Carter",
  "david-rockefeller.jpg": "David Rockefeller",
  "liliane-bettencourt.jpg": "Liliane Bettencourt",
  "ingvar-kamprad.jpg": "Ingvar Kamprad",
  "paul-allen.jpg": "Paul Allen",
  "herb-kelleher.jpg": "Herb Kelleher",
  "sumner-redstone.jpg": "Sumner Redstone",
  "sheldon-adelson.jpg": "Sheldon Adelson",
  "arne-sorenson.jpg": "Arne Sorenson",
  "dietrich-mateschitz.jpg": "Dietrich Mateschitz",
  "charlie-munger.jpg": "Charlie Munger",
  "ratan-tata.jpg": "Ratan Tata",
};

const DOG_PAGES = {
  "flotus-champ-major.jpg": ["Major (dog)", "Champ (dog)"],
  "potus-commander.jpg": ["Commander (dog)"],
  "potus-champ.jpg": ["Champ (dog)", "Major (dog)"],
  "flotus-haney-commander.jpg": ["Commander (dog)"],
  "dod-k9-2020.jpg": ["Military working dog"],
  "dha-k9-2021.jpg": ["Military working dog"],
  "82nd-k9-2020.jpg": ["Military working dog"],
  "army-k9-2020.jpg": ["Military working dog"],
};

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function wikiThumb(title) {
  const api = new URL("https://en.wikipedia.org/w/api.php");
  api.searchParams.set("action", "query");
  api.searchParams.set("titles", title);
  api.searchParams.set("prop", "pageimages");
  api.searchParams.set("pithumbsize", "480");
  api.searchParams.set("format", "json");
  api.searchParams.set("redirects", "1");
  const data = await fetchJson(api);
  const page = Object.values(data.query?.pages || {})[0];
  return page?.thumbnail?.source || null;
}

async function download(url, dest) {
  const res = await fetch(url, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 800) throw new Error("too small");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

async function grab(dest, titles) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
    console.log(`keep ${path.basename(dest)}`);
    return true;
  }
  for (const title of titles) {
    try {
      const url = await wikiThumb(title);
      if (!url) continue;
      await download(url, dest);
      console.log(`ok  ${path.basename(dest)} ← ${title}`);
      return true;
    } catch (err) {
      console.log(`skip ${title}: ${err.message}`);
    }
  }
  console.log(`miss ${path.basename(dest)}`);
  return false;
}

let people = 0;
for (const [file, title] of Object.entries(PEOPLE_PAGES)) {
  if (await grab(path.join(PEOPLE, file), [title])) people += 1;
}
let dogs = 0;
for (const [file, titles] of Object.entries(DOG_PAGES)) {
  if (await grab(path.join(DOGS, file), titles)) dogs += 1;
}
console.log(`people ${people}/${Object.keys(PEOPLE_PAGES).length} dogs ${dogs}/${Object.keys(DOG_PAGES).length}`);
