# Płatności i dostawa w prywatnym podglądzie

Opus 5.5 high wdrożył testowy przelew, pobranie i rodzaje dostaw w osobnym worktree. Prowadzący agent przejrzał kod, usunął nieużywaną akcję omijającą kontrolowany checkout, zamknął zmiany pozycji i zgód zamówienia oraz dopracował powtarzane anulowanie i odświeżenie wyceny.

Online korzysta z wymiennego adaptera internal-test. Przelew i pobranie pozostają wyłączone, dopóki administrator jawnie nie określi rezerwacji. Kod nie podaje prawdziwego rachunku, nie pobiera pieniędzy i nie nadaje przesyłek. Publiczny link zamówienia offline pozwala anulować oczekującą rezerwację; potwierdzenia wpływu i pobrania wykonuje zalogowana obsługa z audytem.

Dostawy obejmują kuriera, ręcznie wpisany punkt odbioru oraz odbiór osobisty. Serwer liczy cenę w groszach, dopłatę za pobranie i zatwierdzony próg darmowej dostawy. Zamówienie zachowuje niezmienny zapis wyceny. Nadane testowo pobranie nie wygasa i nie przywraca magazynu automatycznie.

Testy obejmują konfigurację, wymagane dane, ceny, rezerwacje, idempotencję, role, potwierdzenia i spóźnione zdarzenia. Aktualne wyniki oraz dowód GUI są w checkpoincie. Integracja z konkretnym operatorem, weryfikacja punktu przez przewoźnika, realne stawki i zasady zwrotów wymagają danych od Wojtka; nie są potwierdzone przez adapter wewnętrzny.
