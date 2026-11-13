# Daily Reader

Личное PWA для ежедневного чтения на английском: отрывок дня из своих книг, объяснение слова по тапу, карточки FSRS.

## Книги → JSON (на Маке)

```bash
../venv/bin/python tools/convert.py --all     # все книги из tools/library.json → books/*.json
../venv/bin/python tools/preview.py           # books/preview.html — проверить текст глазами
../venv/bin/python tools/convert.py Book.pdf  # одна книга
```

`books/` не попадает в git: книги личные.

## Приложение

```bash
npm install
npm run dev        # http://localhost:5173 и адрес в сети (Network) для iPhone
npm test           # логика отрывка дня, очереди книг, дат
npm run build      # dist/ — статический сайт
npm run wordlist   # пересобрать src/data/common-words.json (топ‑3000 слов)
```

В режиме `dev` в Библиотеке есть кнопка «Load from Mac (dev)»: она загружает все `books/*.json`
прямо с Мака. В собранной версии её нет — там книги добавляются через «Add books» (Файлы / iCloud / AirDrop).

## Устройство

- `src/lib/` — чистая логика: отрывок дня (`excerpt.ts`), очередь книг (`plan.ts`), сложность (`words.ts`), дни и серия (`day.ts`).
- Тап по слову: `src/lib/textpos.ts` (слово и предложение под пальцем), `src/lib/lemma.ts` (базовая форма
  и часть речи по контексту), `src/lib/explain.ts` (`ExplanationProvider`: Free Dictionary, перевод MyMemory),
  `src/components/WordPopover.tsx`. В сеть уходит только само слово, не предложение из книги; ответы кэшируются.
- Карточки: `ts-fsrs` (`src/store/cards.ts`), сессия, пропуск в предложении и лимит 15 новых в день —
  `src/lib/review.ts`. «Учить» создаёт карточку, «Знаю» и удаление слова её убирают. «Выучено» — интервал ≥ 21 дня.
- Книга «сложная», если в отрывке > 8% слов вне топ‑3000 частотных (решение 2026‑11‑02; в ТЗ был топ‑1500,
  но с ним сложными выходили все книги).
- `src/store/` — IndexedDB: книги, место чтения, план на день, настройки.
- `src/screens/` — экраны Today, Library, Reader, Settings.

## Публикация (PWA)

- `npm run build` → `dist/`: статический сайт с офлайн-кэшем (vite-plugin-pwa) и манифестом для иконки на iPhone.
- **GitHub Pages:** репозиторий с этой папкой, ветка `main`, в настройках Pages источник — «GitHub Actions».
  Каждый `git push` собирает и публикует сайт ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)),
  адрес — `https://<логин>.github.io/<репозиторий>/`.
- Книги в репозиторий не попадают: `books/`, `*.pdf`, `*.epub` и список личных файлов `tools/library.json`
  в `.gitignore` (образец — `tools/library.example.json`).

## Резервная копия

Настройки → «Сохранить копию»: один JSON с книгами, словами, карточками и прогрессом (через «Поделиться» →
«Сохранить в Файлы»). «Восстановить из копии» заменяет все данные на устройстве. Раз в неделю на экране «Сегодня»
появляется напоминание. Так же переносятся данные с dev-адреса на настоящий.

## Объяснения и устойчивые выражения

- Объяснение слова: сначала Simple English Wiktionary (простые определения), если там нет — Free Dictionary API.
- Тап по слову, которое в этом предложении входит в устойчивое выражение (*make up one's mind*, *turn the light off*,
  *on the verge of*), показывает всё выражение; переключатель в карточке — «только слово». Выражения учатся и
  повторяются целиком, в тексте подчёркиваются так же, как слова.
- Список выражений (~19 500: идиомы, фразовые глаголы, устойчивые фразы) — из Wiktionary (CC BY-SA 4.0):
  `npm run phrases` скачивает выжимку с kaikki.org (`scripts/fetch-phrases.py`) и собирает `src/data/phrases.json`.
  Логика поиска и фильтры шума — `src/lib/phrases.ts`.
