/* Seed demo Underwater.pl — treści i zdjęcia produktów pochodzą z obecnej strony underwater.pl.
   Zakres celowo mały: 6 kategorii, 3 produkty, 5 kursów. To demo, nie migracja. */
import path from 'path'
import { fileURLToPath } from 'url'
import { getPayload } from 'payload'
import config from '../src/payload.config'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const mediaDir = path.resolve(dirname, '../seed-media')

async function main() {
  const payload = await getPayload({ config })
  const existing = await payload.count({ collection: 'products' })
  if (existing.totalDocs > 0 && !process.argv.includes('--force')) {
    console.log('[seed] dane już są, pomijam')
    process.exit(0)
  }

  if ((await payload.count({ collection: 'users' })).totalDocs === 0) {
    await payload.create({ collection: 'users', data: { email: 'demo@underwater.pl', password: 'underwater2026', name: 'Demo Underwater' } })
    console.log('[seed] konto demo@underwater.pl / underwater2026')
  }

  const up = async (file: string, alt: string) =>
    (await payload.create({ collection: 'media', data: { alt }, filePath: path.join(mediaDir, file) })).id

  const cat = async (name: string, slug: string, vmId: number, order: number, parent?: number) =>
    (await payload.create({ collection: 'categories', data: { name, slug, vmId, order, parent } })).id as number

  const cats: Record<number, number> = {}
  const roots: [string, string, number][] = [
    ['Automaty oddechowe', '1-automaty-oddechowe', 1],
    ['Komputery nurkowe', '67-komputery-nurkowe', 67],
    ['Maski i fajki', '80-maski-i-fajki', 80],
    ['Jackety nurkowe', '251-jackety-nurkowe', 251],
    ['Skafandry', '90-skafandry-mokre', 90],
    ['Junior', '345-junior', 345],
  ]
  let i = 0
  for (const [name, slug, vmId] of roots) cats[vmId] = await cat(name, slug, vmId, i++)
  cats[346] = await cat('Maski i fajki junior', '345-junior/346-maska-fajka-junior', 346, 0, cats[345])
  console.log('[seed] kategorie:', Object.keys(cats).length)

  const maskBlack = await up('SoprasTek_Corona_black.jpg', 'Maska SoprasTek Corona Frameless, czarny silikon')
  const maskWhite = await up('SoprasTek_Corona_white.jpg', 'Maska SoprasTek Corona Frameless, biały silikon')
  await payload.create({ collection: 'products', data: {
    name: 'Maska SoprasTek Corona Frameless', vmId: 3625, slug: '3625-maska-soprastek-corona', category: cats[80], manufacturer: 'SoprasSub',
    price: 277, salePrice: 269, stock: 6, featured: true, images: [maskBlack, maskWhite],
    short: 'Maska bez ramki o zmniejszonym profilu, zaprojektowana z myślą o mniejszych twarzach. Szerokie pole widzenia i łatwy dostęp do nosa.',
    features: ['Zmniejszony profil — dobrze siada na mniejszej twarzy', 'Konstrukcja frameless, bez plastikowej ramki', 'Zminimalizowana objętość maski', 'Łatwy dostęp do nosa przy wyrównywaniu ciśnienia', 'Szerokie pole widzenia, wysoka przezroczystość szyby'].map((text) => ({ text })),
    variants: [{ label: 'Czarny silikon', stock: 4, image: maskBlack }, { label: 'Biały silikon', stock: 2, image: maskWhite }],
    specs: [{ key: 'Typ', value: 'Jednoszybowa, frameless' }, { key: 'Silikon', value: 'Hipoalergiczny, klasa medyczna' }, { key: 'Gwarancja', value: '24 miesiące' }],
  } })

  const g2a = await up('Scubapro_Galileo_G2_ekran.jpg', 'Komputer Scubapro Galileo 2 – ekran')
  const g2b = await up('Scubapro_Galileo_G2_kopmas.jpg', 'Komputer Scubapro Galileo 2 – kompas')
  await payload.create({ collection: 'products', data: {
    name: 'Komputer Scubapro Galileo 2', vmId: 2176, slug: '2176-komputer-scubapro-galileo-2', category: cats[67], manufacturer: 'Scubapro',
    price: 3880, salePrice: 3549, stock: 3, featured: true, images: [g2a, g2b],
    short: 'Kolorowy komputer nurkowy z pięcioma trybami pracy: rekreacyjnym, CCR, trimiks, freediving i sidemount. W zestawie kabel USB, folia ochronna, retraktor i pokrowiec.',
    features: ['Wersja na nadgarstek albo do konsoli', 'Pięć trybów: rekreacyjny, CCR, trimiks, freediving, sidemount', 'Ekran TFT 5,6 cm w pełnym kolorze', 'Algorytm ZH-L16 ADT MB PMG', 'Cztery układy wyświetlacza do wyboru'].map((text) => ({ text })),
    variants: [{ label: 'Na nadgarstek', stock: 2, image: g2a }, { label: 'Do konsoli', stock: 1, image: g2b }],
    specs: [{ key: 'Ekran', value: 'TFT LCD 5,6 cm, 320×240' }, { key: 'Algorytm', value: 'ZH-L16 ADT MB PMG' }, { key: 'Tryby', value: 'Scuba, Gauge, Freediving, CCR, Sidemount' }, { key: 'W zestawie', value: 'kabel USB, folia, retraktor, pokrowiec' }],
  } })

  const tY = await up('TUSA_Kleion_mini_fit_UC-0211P_yellow.jpg', 'Zestaw TUSA Kleio mini FIT – żółty')
  const tP = await up('TUSA_Kleion_mini_fit_UC-0211P_pink.jpg', 'Zestaw TUSA Kleio mini FIT – różowy')
  const tB = await up('TUSA_Kleion_mini_fit_UC-0211P_blue.jpg', 'Zestaw TUSA Kleio mini FIT – niebieski')
  await payload.create({ collection: 'products', data: {
    name: 'Zestaw TUSA UC0211P KLEIO mini FIT', vmId: 3261, slug: '3261-zestaw-tusa-uc0211p-kleio-mini-fit', category: cats[346], manufacturer: 'Tusa',
    price: 159, salePrice: 139, stock: 9, featured: true, images: [tY, tP, tB],
    short: 'Zestaw dla dzieci: maska z pierścieniem dopasowującym wbudowanym w kołnierz oraz fajka z dziecięcym ustnikiem. Dla dzieci w wieku 3–10 lat.',
    features: ['Dopasowanie rozmiaru jednym pociągnięciem za pierścień', 'Kołnierz ze 100% hipoalergicznego silikonu', 'Fajka Hyperdry Semi Dry-Top', 'Adapter One Touch do szybkiego zapinania fajki'].map((text) => ({ text })),
    variants: [{ label: 'Żółty', stock: 3, image: tY }, { label: 'Różowy', stock: 3, image: tP }, { label: 'Niebieski', stock: 3, image: tB }],
    specs: [{ key: 'Wiek', value: '3–10 lat' }, { key: 'Gwarancja', value: '24 miesiące' }],
  } })
  console.log('[seed] produkty: 3')

  const owdImg = await up('kurs_owd.jpg', 'Instruktor i kursantka na zajęciach basenowych kursu PADI Open Water Diver')
  const owdPool = await up('kurs_basenowy_padi_owd_big.jpg', 'Zajęcia basenowe kursu PADI OWD')
  const courses = [
    { name: 'PADI Open Water Diver', slug: 'padi-open-water-diver', org: 'PADI', level: 'basic', maxDepth: 18, minAge: 10, price: 2200, order: 1, featured: true,
      nextDate: '2026-09-07T18:30:00.000Z', image: owdImg, gallery: [owdImg, owdPool],
      lead: 'Pierwszy stopień nurkowy. Po kursie nurkujesz z partnerem do 18 metrów, bez asysty instruktora, na całym świecie.',
      sections: [
        { title: 'Dlaczego warto', body: 'Certyfikat PADI Open Water Diver honorowany jest w każdym centrum nurkowym na świecie. Po kursie nurkujesz z partnerem o tych samych uprawnieniach, do 18 metrów, bez asysty divemastera czy instruktora. To dokument bezterminowy — raz zdobyty, zostaje z Tobą.' },
        { title: 'Kto może wziąć udział', body: 'Minimalny wiek to 10 lat. Osoby w wieku 10–14 lat otrzymują certyfikat PADI Junior Open Water Diver i nurkują do 12 metrów z instruktorem albo z rodzicem z uprawnieniami. Wymagany jest ogólnie dobry stan zdrowia i umiejętność pływania.' },
        { title: 'Jak wygląda kurs', body: 'Pięć spotkań teoretycznych i pięć zajęć basenowych w Warszawie, zakończonych egzaminem. Następnie cztery nurkowania w wodach otwartych: w jeziorze, kamieniołomie albo w morzu podczas wyprawy. Uczysz się obsługi sprzętu, technik nurkowania oraz planowania bezpiecznych nurkowań.' },
        { title: 'Ile trwa', body: 'Certyfikat otrzymujesz po prawidłowym wykonaniu wszystkich ćwiczeń. Każdy uczestnik ma na to tyle czasu, ile potrzebuje — nie gonimy nikogo. Standardowo kurs zamyka się w trzy do czterech tygodni. Płatność można rozłożyć na raty.' },
      ],
      includes: ['Materiały szkoleniowe PADI', 'Logbook — rejestr nurkowań', 'Sprzęt na zajęcia basenowe', 'Certyfikat PADI Open Water Diver', 'Opieka instruktora w grupie do czterech osób'] },
    { name: 'PADI Advanced Open Water Diver', slug: 'padi-advanced-open-water-diver', org: 'PADI', level: 'advanced', maxDepth: 30, minAge: 12, price: 1900, order: 2, featured: true,
      lead: 'Pięć nurkowań przygodowych, w tym głębokie i nawigacyjne. Uprawnienia do 30 metrów i wstęp do specjalizacji.',
      sections: [
        { title: 'Co robisz na kursie', body: 'Pięć nurkowań specjalistycznych pod okiem instruktora: obowiązkowo głębokie i nawigacyjne, do tego trzy do wyboru — nocne, wrakowe, nitroksowe, doskonałej pływalności albo suchy skafander.' },
        { title: 'Wymagania', body: 'Certyfikat PADI Open Water Diver lub równoważny z innej federacji. Minimalny wiek 12 lat.' },
      ],
      includes: ['Materiały PADI', 'Pięć nurkowań z instruktorem', 'Certyfikat PADI Advanced Open Water Diver'] },
    { name: 'PADI Rescue Diver', slug: 'padi-rescue-diver', org: 'PADI', level: 'rescue', maxDepth: 30, minAge: 12, price: 2400, order: 3, featured: true,
      lead: 'Zapobieganie problemom pod wodą i pomoc innym nurkom. Najbardziej wymagający i najbardziej satysfakcjonujący kurs rekreacyjny.',
      sections: [
        { title: 'Czego się nauczysz', body: 'Rozpoznawania stresu u nurka, reagowania na sytuacje awaryjne, wyciągania poszkodowanego z wody i prowadzenia akcji ratowniczej. Kurs zmienia sposób, w jaki patrzysz na nurkowanie: przestajesz myśleć tylko o sobie.' },
        { title: 'Wymagania', body: 'PADI Advanced Open Water Diver oraz aktualny kurs pierwszej pomocy — Emergency First Response robimy u nas w jeden dzień.' },
      ],
      includes: ['Materiały PADI Rescue', 'Scenariusze ratownicze na wodach otwartych', 'Certyfikat PADI Rescue Diver'] },
    { name: 'PADI Enriched Air Nitrox', slug: 'padi-nitrox-diver', org: 'PADI', level: 'specialty', minAge: 12, price: 750, order: 4,
      lead: 'Najpopularniejsza specjalizacja. Dłuższy czas na dnie dzięki nurkowaniu na wzbogaconym powietrzu.',
      sections: [{ title: 'Jak wygląda', body: 'Teoria plus analiza mieszanki i planowanie nurkowania. Kurs zamyka się w jeden wieczór, nurkowania nie są obowiązkowe.' }],
      includes: ['Materiały PADI', 'Certyfikat PADI Enriched Air Diver'] },
    { name: 'PADI Divemaster', slug: 'padi-divemaster', org: 'PADI', level: 'pro', maxDepth: 40, minAge: 18, order: 5,
      lead: 'Pierwszy stopień zawodowy. Prowadzenie nurkowań, opieka nad grupą i asysta przy kursach.',
      sections: [{ title: 'Dla kogo', body: 'Dla nurków, którzy chcą pracować w branży albo po prostu wejść na poziom, na którym nurkowanie staje się drugą naturą. Program rozłożony jest na kilka miesięcy i obejmuje staż w naszym centrum.' }],
      includes: ['Program stażowy w centrum nurkowym', 'Materiały PADI Divemaster', 'Certyfikat PADI Divemaster'] },
  ]
  for (const c of courses) {
    await payload.create({ collection: 'courses', data: { ...c, includes: c.includes?.map((text) => ({ text })) } as any })
  }
  console.log('[seed] kursy:', courses.length)

  const heroFile = 'hero.jpg'
  let hero: number | undefined
  try { hero = await up(heroFile, 'Nurek pod powierzchnią wody') as number } catch { console.log('[seed] brak hero.jpg, pomijam') }

  await payload.updateGlobal({ slug: 'settings', data: {
    banner: 'Najbliższy kurs OWD: 7 września, Warszawa',
    heroTitle: 'Zabieramy ludzi pod wodę od 1998 roku',
    heroText: 'Centrum nurkowe w Warszawie. Kursy PADI, TDI/SDI i IANTD, sklep z gwarancją najniższej ceny, autoryzowany serwis sprzętu i wyprawy, na które sami jeździmy.',
    heroImage: hero,
    priceGuarantee: 'Znajdziesz ten sam produkt taniej w Polsce w ciągu 14 dni od zakupu? Zwracamy różnicę.',
    phone: '+48 504 16 20 14', email: 'underwater@underwater.pl', address: 'ul. Okopowa 31/94\n01-059 Warszawa', nip: 'PL7621146643',
    facebook: 'https://www.facebook.com/Nurkowanie.Wawa', youtube: 'http://www.youtube.com/user/underwaterrz',
  } })
  console.log('[seed] gotowe')
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
