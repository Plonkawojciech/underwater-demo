import type { CollectionConfig } from 'payload'
import { validateSession } from '../lib/catalog-validation'
import { publicContentAccess } from '../lib/access'
import { contentFields } from './fields'

export const CourseSessions: CollectionConfig = {
  slug: 'course-sessions', labels: { singular: 'Termin kursu', plural: 'Terminy kursów' },
  admin: { useAsTitle: 'title', group: 'Szkolenia', defaultColumns: ['title', 'course', 'startsAt', 'published', 'capacity', 'reserved'], description: 'Opublikowany przyszły termin pojawia się przy kursie i w kalendarzu. Kurs także musi być opublikowany.', components: { edit: { SaveButton: '@/components/admin/ValidatedSaveButton' } } }, access: publicContentAccess,
  hooks: { beforeValidate: [validateSession] },
  fields: [
    { name: 'title', label: 'Nazwa terminu', type: 'text', required: true, admin: { description: 'Np. Open Water Diver, grupa listopadowa. Taką nazwę zobaczy klient w formularzu zgłoszenia.' } },
    { name: 'course', label: 'Kurs', type: 'relationship', relationTo: 'courses', required: true, index: true },
    { name: 'startsAt', label: 'Początek', type: 'date', required: true, index: true, admin: { components: { Field: '@/components/admin/AccessibleDateField' }, date: { pickerAppearance: 'dayAndTime', displayFormat: 'dd.MM.yyyy HH:mm', timeFormat: 'HH:mm' }, description: 'Wybierz dzień i godzinę lub wpisz je w formacie 15.11.2026 10:00. Po zapisaniu sprawdź godzinę na stronie kursu; strona pokazuje czas Warszawy.' } },
    { name: 'endsAt', label: 'Koniec', type: 'date', admin: { components: { Field: '@/components/admin/AccessibleDateField' }, date: { pickerAppearance: 'dayAndTime', displayFormat: 'dd.MM.yyyy HH:mm', timeFormat: 'HH:mm' }, description: 'Opcjonalnie; nie może poprzedzać początku. Wpisz dzień i godzinę w formacie 15.11.2026 18:00.' } },
    { name: 'location', label: 'Miejsce', type: 'text' },
    { name: 'priceCents', label: 'Cena terminu (zł)', type: 'number', min: 0, admin: { description: 'Np. 1500,00. Puste pole pozostawia cenę kursu jako cenę główną; wpisana cena zastępuje ją dla tego terminu.', components: { Field: '@/components/admin/MoneyField' } } },
    { name: 'capacity', label: 'Potwierdzony limit miejsc', type: 'number', min: 1, admin: { description: 'Puste pole oznacza brak potwierdzonego limitu. Formularz zbiera zgłoszenia; nie deklaruje wolnych miejsc.' } },
    { name: 'reserved', label: 'Zarezerwowane miejsca', type: 'number', min: 0, defaultValue: 0, admin: { readOnly: true, description: 'Licznik uzupełniają zgłoszenia. Limit miejsc nie może być niższy od tej liczby.' } },
    ...contentFields,
  ],
}
