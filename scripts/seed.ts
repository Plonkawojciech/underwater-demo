/* Seed danych demo Underwater.pl — treści i zdjęcia pochodzą z obecnej strony underwater.pl */
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { getPayload } from 'payload'
import config from '../src/payload.config'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const mediaDir = path.resolve(dirname, '../seed-media')

async function main() {
  const payload = await getPayload({ config })
  const existing = await payload.count({ collection: 'products' })
  if (existing.totalDocs > 0 && !process.argv.includes('--force')) {
    console.log('[seed] dane już są, pomijam (użyj --force, żeby dodać ponownie)')
    process.exit(0)
  }

  const users = await payload.count({ collection: 'users' })
  if (users.totalDocs === 0) {
    await payload.create({ collection: 'users', data: { email: 'demo@underwater.pl', password: 'underwater2026', name: 'Demo Underwater' } })
    console.log('[seed] użytkownik demo@underwater.pl / underwater2026')
  }

  const up = async (file: string, alt: string) => {
    const doc = await payload.create({ collection: 'media', data: { alt }, filePath: path.join(mediaDir, file) })
    return doc.id
  }

  const cat = async (name: string, slug: string, vmId: number, order: number, parent?: number) => {
    const c = await payload.create({ collection: "categories", data: { name, slug, vmId, order, parent } })
    return c.id as number
  }

  const categoriesRaw: [string, string, number][] = [
    ['Akcesoria nurkowe', '9-akcesoria-nurkowe', 9], ['Akcesoria chemiczne', '243-akcesoria-chemiczne', 243], ['Argon', '138-argon', 138],
    ['Analizatory', '239-analizatory', 239], ['Automaty oddechowe', '1-automaty-oddechowe', 1], ['Balast nurkowy', '10-balast-nurkowy', 10],
    ['Butle i zawory', '7-butle-i-zawory', 7], ['Buty i rękawice nurkowe', '37-buty-i-rekawice-nurkowe', 37], ['Fotografia i video', '40-fotografia-i-video', 40],
    ['Freediving', '42-freediving', 42], ['Instrumenty pomiarowe', '45-instrumenty-pomiarowe', 45], ['Jackety nurkowe', '251-jackety-nurkowe', 251],
    ['Junior', '345-junior', 345], ['Komputery nurkowe', '67-komputery-nurkowe', 67], ['Latarki nurkowe', '73-latarki-nurkowe', 73],
    ['Literatura nurkowa', '77-literatura-nurkowa', 77], ['Łowiectwo podwodne', '201-lowiectwo-podwodne', 201], ['Maski i fajki', '80-maski-i-fajki', 80],
    ['Noże nurkowe', '84-noze-nurkowe', 84], ['Odzież nurkowa', '144-odziez-nurkowa', 144], ['Płetwy nurkowe', '85-pletwy-nurkowe', 85],
    ['Rebreather', '266-rebreather', 266], ['Serwis', '293-serwis', 293], ['Skafandry mokre', '90-skafandry-mokre', 90], ['Skafandry suche', '99-skafandry-suche', 99],
    ['Skutery podwodne', '107-skutery-podwodne', 107], ['Sprężarki', '110-sprezarki', 110], ['Tlen: akcesoria i zestawy', '113-tlen-akcesoria-i-zestawy', 113],
    ['Torby i pojemniki', '117-torby-i-pojemniki', 117], ['Węże nurkowe', '118-weze-nurkowe', 118], ['Wyprzedaż', '122-wyprzedaz', 122],
  ]
  const cats: Record<number, number> = {}
  let i = 0
  for (const [name, slug, vmId] of categoriesRaw) cats[vmId] = await cat(name, slug, vmId, i++)
  cats[248] = await cat('Sidemount', '251-jackety-nurkowe/248-sidemount', 248, 100, cats[251])
  cats[346] = await cat('Maska+fajka Junior', '345-junior/346-maska-fajka-junior', 346, 101, cats[345])
  console.log('[seed] kategorie:', Object.keys(cats).length)

  // Produkty
  const maskBlack = await up('SoprasTek_Corona_black.jpg', 'Maska SoprasTek Corona Frameless, czarny silikon')
  const maskWhite = await up('SoprasTek_Corona_white.jpg', 'Maska SoprasTek Corona Frameless, biały silikon')
  await payload.create({ collection: 'products', data: {
    name: 'Maska SoprasTek Corona Frameless', vmId: 3625, slug: '3625-maska-soprastek-corona', category: cats[80], manufacturer: 'SoprasSub',
    price: 277, salePrice: 269, stock: 6, featured: true, images: [maskBlack, maskWhite],
    short: 'Maska bez ramki o zmniejszonym profilu, zaprojektowana z myślą o mniejszych twarzach. Bardzo szerokie pole widzenia i łatwy dostęp do nosa.',
    features: ['Specjalnie zaprojektowana dla pań – zmniejszony profil maski', 'Bez plastikowej ramki (frameless)', 'Zminimalizowana objętość maski', 'Łatwy dostęp do nosa, co ułatwia wyrównywanie ciśnienia', 'Łatwe i bezawaryjne klamry paska', 'Bardzo szerokie pole widzenia', 'Wysoka przezroczystość szyby'].map((text) => ({ text })),
    variants: [{ label: 'Czarny silikon', stock: 4, image: maskBlack }, { label: 'Biały silikon', stock: 2, image: maskWhite }],
    specs: [{ key: 'Typ', value: 'Jednoszybowa, frameless' }, { key: 'Silikon', value: 'Hipoalergiczny, klasa medyczna' }, { key: 'Gwarancja', value: '24 miesiące' }],
  } })

  const g2a = await up('Scubapro_Galileo_G2_ekran.jpg', 'Komputer Scubapro Galileo 2 – ekran')
  const g2b = await up('Scubapro_Galileo_G2_kopmas.jpg', 'Komputer Scubapro Galileo 2 – kompas')
  await payload.create({ collection: 'products', data: {
    name: 'Komputer Scubapro Galileo 2', vmId: 2176, slug: '2176-komputer-scubapro-galileo-2', category: cats[67], manufacturer: 'Scubapro',
    price: 3880, salePrice: 3549, stock: 3, featured: true, images: [g2a, g2b],
    short: 'Kolorowy komputer nurkowy z pięcioma trybami pracy: rekreacyjnym, CCR, trimiks, freediving i sidemount. W zestawie kabel USB, folia ochronna, retraktor i pokrowiec.',
    features: ['Wersja na nadgarstek lub do konsoli', '5 trybów pracy: rekreacyjny, CCR, TMX, freediving, sidemount', 'Obudowa z termoplastiku wzmocnionego włóknem szklanym', 'Ekran TFT full color 5,6 cm, 320×240 px', 'Algorytm ZH-L16 ADT MB PMG', 'Cztery układy wyświetlacza: Light, Classic, Full, Graphical', 'Zintegrowane uchwyty na klipy retraktora i paski bungee'].map((text) => ({ text })),
    variants: [{ label: 'Na nadgarstek', stock: 2, image: g2a }, { label: 'Do konsoli', stock: 1, image: g2a }],
    specs: [{ key: 'Ekran', value: 'TFT LCD 5,6 cm, 320×240' }, { key: 'Algorytm', value: 'ZH-L16 ADT MB PMG' }, { key: 'Tryby', value: 'Scuba, Gauge, Freediving, CCR, Sidemount' }, { key: 'W zestawie', value: 'kabel USB, folia 3M, retraktor, pokrowiec' }],
  } })

  const tY = await up('TUSA_Kleion_mini_fit_UC-0211P_yellow.jpg', 'Zestaw TUSA Kleio mini FIT – żółty')
  const tP = await up('TUSA_Kleion_mini_fit_UC-0211P_pink.jpg', 'Zestaw TUSA Kleio mini FIT – różowy')
  const tB = await up('TUSA_Kleion_mini_fit_UC-0211P_blue.jpg', 'Zestaw TUSA Kleio mini FIT – niebieski')
  await payload.create({ collection: 'products', data: {
    name: 'Zestaw TUSA UC0211P KLEIO mini FIT', vmId: 3261, slug: '3261-zestaw-tusa-uc0211p-kleio-mini-fit', category: cats[346], manufacturer: 'Tusa',
    price: 159, salePrice: 139, stock: 9, featured: true, images: [tY, tP, tB],
    short: 'Zestaw dla dzieci: jednoszybowa maska z pierścieniem dopasowującym wbudowanym w kołnierz oraz fajka z dziecięcym ustnikiem. Polecany dla dzieci w wieku 3–10 lat.',
    features: ['Łatwe dopasowanie do rozmiaru głowy przez pociągnięcie za pierścień mocujący', 'Kołnierz ze 100% hipoalergicznego silikonu klasy chirurgicznej', 'Zaokrąglone krawędzie – komfort i dopasowanie do każdej twarzy', 'Cicha, łatwa regulacja klamry', 'Fajka Hyperdry Semi Dry-Top', 'Adapter One Touch do szybkiego zapinania fajki'].map((text) => ({ text })),
    variants: [{ label: 'Żółty', stock: 3, image: tY }, { label: 'Różowy', stock: 3, image: tP }, { label: 'Niebieski', stock: 3, image: tB }],
    specs: [{ key: 'Wiek', value: '3–10 lat' }, { key: 'Gwarancja', value: '24 miesiące' }],
  } })
  console.log('[seed] produkty: 3')

  // Kursy
  const owdImg = await up('kurs_nurkowania_owd_big.jpg', 'Kurs PADI Open Water Diver – nurkowanie w wodach otwartych')
  const owdPool = await up('kurs_basenowy_padi_owd_big.jpg', 'Zajęcia basenowe kursu PADI OWD')
  const courses: Array<{ name: string; slug: string; org: any; level: any; maxDepth?: number; minAge?: number; lead: string; order: number; featured?: boolean; nextDate?: string; image?: any; gallery?: any[]; sections?: any[]; includes?: string[] }> = [
    { name: 'PADI Open Water Diver', slug: 'padi-open-water-diver', org: 'PADI', level: 'basic', maxDepth: 18, minAge: 10, order: 1, featured: true, nextDate: '2026-09-07T18:30:00.000Z', image: owdImg, gallery: [owdImg, owdPool],
      lead: 'Pierwszy stopień nurkowy. Po kursie nurkujesz z partnerem do 18 m bez asysty instruktora, na całym świecie.',
      sections: [
        { title: 'Dlaczego warto', body: 'Jako certyfikowany płetwonurek PADI Open Water Diver masz możliwość nurkowania z partnerem o co najmniej tych samych uprawnieniach, bez asysty Divemastera czy instruktora, do głębokości 18 m. Jeśli masz już certyfikat PADI Discover Scuba Diving lub PADI Scuba Diver, ustal z instruktorem harmonogram swojego kursu.' },
        { title: 'Kto może wziąć udział', body: 'Minimalny wiek to 10 lat. Kandydaci w wieku 10–14 lat otrzymują certyfikat PADI Junior Open Water Diver i nurkują do 12 m z instruktorem lub rodzicem z uprawnieniami co najmniej OWD. Wymagany jest ogólnie dobry stan zdrowia.' },
        { title: 'Jak wygląda kurs', body: 'Pięć zajęć basenowych i pięć zajęć wykładowych zakończonych egzaminem teoretycznym. Następnie cztery nurkowania w wodach otwartych: w jeziorze, kamieniołomie lub w morzu. Poznasz sprzęt, technikę nurkowania oraz planowanie i organizację bezpiecznych nurkowań.' },
        { title: 'Ile trwa', body: 'Certyfikat otrzymujesz po prawidłowym wykonaniu wszystkich ćwiczeń z programu. Każdy uczestnik ma tyle czasu, ile potrzebuje, żeby nabyć umiejętności. Kurs można rozłożyć na raty.' },
      ],
      includes: ['Materiały szkoleniowe PADI', 'Logbook (rejestr nurkowań)', 'Sprzęt na zajęcia basenowe', 'Certyfikat PADI Open Water Diver'] },
    { name: 'PADI Scuba Review', slug: 'scuba-review', org: 'PADI', level: 'intro', order: 0, lead: 'Odświeżenie umiejętności po przerwie w nurkowaniu. Basen i teoria w jeden wieczór.' },
    { name: 'PADI Skin Diver', slug: 'padi-skin-diver', org: 'PADI', level: 'intro', order: 2, lead: 'Nurkowanie z maską, fajką i płetwami. Dobry start dla dzieci i osób, które chcą poczuć wodę bez butli.' },
    { name: 'PADI OWD Referral', slug: 'padi-open-water-diver-referral', org: 'PADI', level: 'basic', maxDepth: 18, order: 3, lead: 'Teoria i basen w Warszawie, nurkowania w wodach otwartych na wakacjach w ciepłym morzu.' },
    { name: 'PADI Advanced Open Water Diver', slug: 'padi-advanced-open-water-diver', org: 'PADI', level: 'advanced', maxDepth: 30, minAge: 12, order: 4, featured: true, lead: 'Pięć nurkowań przygodowych, w tym głębokie i nawigacyjne. Uprawnienia do 30 m.' },
    { name: 'Emergency First Response', slug: 'emergency-first-response', org: 'PADI', level: 'rescue', order: 5, lead: 'Pierwsza pomoc i RKO. Warunek przystąpienia do kursu Rescue Diver.' },
    { name: 'PADI Rescue Diver', slug: 'padi-rescue-diver', org: 'PADI', level: 'rescue', maxDepth: 30, order: 6, featured: true, lead: 'Zapobieganie problemom pod wodą i ratowanie innych nurków. Najbardziej wymagający i najbardziej satysfakcjonujący kurs rekreacyjny.' },
    { name: 'PADI Divemaster', slug: 'padi-divemaster', org: 'PADI', level: 'pro', maxDepth: 40, order: 7, lead: 'Pierwszy stopień zawodowy. Prowadzenie nurkowań i asystowanie instruktorom.' },
    { name: 'PADI Master Scuba Diver', slug: 'padi-master-scuba-diver', org: 'PADI', level: 'pro', maxDepth: 40, order: 8, lead: 'Najwyższy stopień rekreacyjny PADI: Rescue plus pięć specjalizacji i 50 zalogowanych nurkowań.' },
    { name: 'PADI Nitrox Diver', slug: 'padi-nitrox-diver', org: 'PADI', level: 'specialty', order: 10, lead: 'Dłuższe nurkowania na wzbogaconym powietrzu. Najpopularniejsza specjalizacja.' },
    { name: 'PADI Dry Suit Diver', slug: 'padi-dry-suit-diver', org: 'PADI', level: 'specialty', order: 11, lead: 'Nurkowanie w suchym skafandrze. W polskich wodach niezbędne przez większość roku.' },
    { name: 'PADI Deep Diver', slug: 'padi-deep-diver', org: 'PADI', level: 'specialty', maxDepth: 40, order: 12, lead: 'Nurkowania do 40 m: planowanie, narkoza azotowa, zarządzanie gazem.' },
    { name: 'PADI Wreck Diver', slug: 'padi-wreck-diver', org: 'PADI', level: 'specialty', order: 13, lead: 'Nurkowania wrakowe, w tym na wrakach Bałtyku.' },
    { name: 'PADI Ice Diver', slug: 'padi-ice-diver', org: 'PADI', level: 'specialty', order: 14, lead: 'Nurkowanie pod lodem. Zimowa specjalizacja dla odważnych.' },
    { name: 'PADI Night Diver', slug: 'padi-night-diver', org: 'PADI', level: 'specialty', order: 15, lead: 'Nurkowania nocne i nawigacja w ciemności.' },
    { name: 'IANTD EANx Diver', slug: 'iantd-eanx-diver', org: 'IANTD', level: 'specialty', order: 20, lead: 'Nitrox w wydaniu IANTD.' },
    { name: 'SDI Side Mount Diver', slug: 'sdi-side-mount-diver', org: 'TDI/SDI', level: 'specialty', order: 21, lead: 'Konfiguracja sidemount: dwie butle po bokach, lepszy trym i dostęp do zaworów.' },
    { name: 'Kurs Freediving', slug: 'kursy-freediving', org: 'Freediving', level: 'basic', order: 22, lead: 'Nurkowanie na zatrzymanym oddechu: technika, relaksacja, bezpieczeństwo.' },
  ]
  for (const c of courses) {
    await payload.create({ collection: 'courses', data: { ...c, sections: c.sections, includes: c.includes?.map((text) => ({ text })) } as any })
  }
  console.log('[seed] kursy:', courses.length)

  // Wyprawy
  const malta = await up('hero_4275682011_nurkowanie_maltagk-is-115.jpg', 'Nurkowanie na Malcie')
  const gozo = await up('nurkowanie_big.jpg', 'Wyspa Gozo')
  await payload.create({ collection: 'trips', data: {
    name: 'Wyprawa na Maltę – wyspa Gozo', slug: 'wyprawa-na-malte-wyspa-gozo-wrzesien', place: 'Gozo', country: 'Malta', dateFrom: '2026-09-16', dateTo: '2026-09-23',
    flights: 'WAW 19:35 – MLA 22:15 / MLA 16:00 – WAW 19:20', featured: true, spotsLeft: 3, image: malta, gallery: [malta, gozo],
    lead: 'Tydzień nurkowań w Morzu Śródziemnym: jaskinie, tunele skalne i wraki wokół Gozo. Przejrzysta woda i widoczność, jakiej nie ma w Polsce.',
    sections: [
      { title: 'Miejsce', body: 'Malta leży na Morzu Śródziemnym między Sycylią a Afryką Północną. Na archipelagu znajdziemy nie tylko przejrzyste morze i poprzecinane rozpadlinami wybrzeże, ale także okazałe budowle historyczne. O Malcie mówi się, że jest ogromnym muzeum pod otwartym niebem.' },
      { title: 'Nurkowania', body: 'Gozo to jaskinie, kominy i tunele skalne, wraki oraz strome ściany. Nurkujemy z brzegu i z łodzi, dwa nurkowania dziennie.' },
    ],
  } })
  const hurghada = await up('hero_nurkowanie_hurghadagk-is-115.jpg', 'Nurkowanie w Hurghadzie')
  await payload.create({ collection: 'trips', data: { name: 'Egipt – Hurghada', slug: 'wyprawa-do-egiptu-hurghada', place: 'Hurghada', country: 'Egipt', image: hurghada, lead: 'Rafy Morza Czerwonego i wraki. Klasyk, do którego wracamy co roku.', sections: [] } })
  const vis = await up('hero_nurkowanie_rabgk-is-115.jpg', 'Nurkowanie w Chorwacji')
  await payload.create({ collection: 'trips', data: { name: 'Chorwacja – wyspa Vis', slug: 'nurkowanie-chorwacja-wyspa-vis', place: 'Vis', country: 'Chorwacja', image: vis, lead: 'Wraki z II wojny światowej i jaskinie Adriatyku.', sections: [] } })
  const sard = await up('hero_stories.Wyprawy_nurkowe.Sardynia.nurkowanie_sardyniagk-is-115.jpg', 'Jaskinie Sardynii')
  await payload.create({ collection: 'trips', data: { name: 'Magiczne jaskinie Sardynii', slug: 'magiczne-jaskinie-sardynii', place: 'Sardynia', country: 'Włochy', image: sard, lead: 'Nurkowania jaskiniowe i kawernowe w krystalicznej wodzie.', sections: [] } })
  console.log('[seed] wyprawy: 4')

  await payload.create({ collection: 'posts', data: { title: 'Wrześniowe kursy PADI OWD – dwa terminy', slug: 'wrzesniowe-kursy-padi-owd', publishedAt: '2026-08-28', excerpt: 'Ruszamy 7 i 14 września o 18:30. Zajęcia basenowe w Warszawie, nurkowania w wodach otwartych na przełomie września i października.', body: 'Ruszamy 7 i 14 września o 18:30. Zajęcia basenowe w Warszawie, nurkowania w wodach otwartych na przełomie września i października. Zapisy telefonicznie lub przez formularz na stronie kursu.', image: owdPool } })
  await payload.create({ collection: 'posts', data: { title: 'Ostatnie miejsca na Gozo', slug: 'ostatnie-miejsca-gozo', publishedAt: '2026-08-20', excerpt: 'Wyprawa 16–23 września. Zostały trzy miejsca.', body: 'Wyprawa 16–23 września. Zostały trzy miejsca. Szczegóły na stronie wyprawy.', image: malta } })

  await payload.updateGlobal({ slug: 'settings', data: {
    banner: 'Rozpocznij kurs nurkowania 07.09.2026 lub 14.09.2026 w Warszawie',
    heroTitle: 'Nauczymy Cię nurkować. W Warszawie, od 1998 roku.',
    heroText: 'Kursy PADI, TDI/SDI i IANTD, sklep nurkowy z gwarancją najniższej ceny, wyprawy i autoryzowany serwis sprzętu. Wszystko w jednym centrum nurkowym.',
    heroImage: malta,
    priceGuarantee: 'Jeśli w ciągu 14 dni od zakupu znajdziesz ten sam produkt w niższej cenie w Polsce, zwrócimy Ci różnicę. Nic nie ryzykujesz.',
    phone: '+48 504 16 20 14', email: 'underwater@underwater.pl', address: 'ul. Okopowa 31/94\n01-059 Warszawa', nip: 'PL7621146643',
    facebook: 'https://www.facebook.com/Nurkowanie.Wawa', youtube: 'http://www.youtube.com/user/underwaterrz',
  } })
  console.log('[seed] gotowe')
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
