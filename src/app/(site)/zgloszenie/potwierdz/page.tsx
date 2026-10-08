import { NewsletterToken } from '@/components/NewsletterToken'
import { isToken } from '@/lib/presentation'
export default async function SignupConfirmation({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  return <section className="section light"><div className="wrap"><h1 className="h2">Potwierdzenie zgłoszenia</h1>{token && isToken(token) ? <NewsletterToken token={token} action="signup" /> : <p>Link jest nieprawidłowy lub niekompletny.</p>}</div></section>
}
