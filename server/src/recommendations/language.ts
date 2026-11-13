import { normalize } from '../matching.ts'

export type Language = 'en' | 'pt' | 'es'

// Common words that are frequent in one of these languages and rare in the others. Words shared by two of them
// (que, de, no, so, a, me, mas, como) are left out, since they would count for both.
const WORDS: Record<Language, Set<string>> = {
  en: new Set('the and you it my that is on for of your we be with im don its ain just but like got all this what know love can up get when they she he was are now if cant out baby never wanna gonna been where there them who how why would could their our'.split(' ')),
  pt: new Set('nao voce eu um uma pra pro meu minha ele isso essa esse tem vou sou foi nois tudo quer mim agora vai gente mano ce seu sua dela dele entao tambem com mais ta ja ninguem coracao hoje sempre fazer quero vem bota'.split(' ')),
  es: new Set('el los las y yo pero para quiero estoy eres soy tengo voy muy nada contigo conmigo bebe asi ahora corazon con mi lo le hoy siempre hacer ven dime mami'.split(' ')),
}
// Ad-libs and vocalizations carry no language.
const FILLER = new Set('yeah yea uh oh ooh ah la na hey ay ey woo skrrt brr huh mm hmm'.split(' '))
const MIN_WORDS = 8
const MIN_SHARE = 0.6

export function detectLanguage(text: string): Language | undefined {
  const counts: Record<Language, number> = { en: 0, pt: 0, es: 0 }
  for (const word of normalize(text).split(' ')) {
    if (!word || FILLER.has(word)) continue
    for (const language of Object.keys(WORDS) as Language[]) if (WORDS[language].has(word)) counts[language]++
  }
  const total = counts.en + counts.pt + counts.es
  if (total < MIN_WORDS) return undefined
  const [best, count] = (Object.entries(counts) as [Language, number][]).sort((a, b) => b[1] - a[1])[0]
  return count / total >= MIN_SHARE ? best : undefined
}

// For songs without lyrics. Only marks that one language uses count: ã, õ and ç are Portuguese, ñ is Spanish.
export function guessFromTitle(title: string): Language | undefined {
  const lower = title.toLowerCase()
  if (/[ãõç]/.test(lower)) return 'pt'
  if (/ñ/.test(lower)) return 'es'
  const words = normalize(title).split(' ')
  const hits = (language: Language) => words.filter((word) => WORDS[language].has(word)).length
  if (hits('pt') >= 2 && hits('en') === 0) return 'pt'
  if (hits('es') >= 2 && hits('en') === 0) return 'es'
  return undefined
}
