import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  CalendarDays,
  Ticket,
  Users,
  ArrowRight,
  Mail,
  CreditCard,
  CircleCheck,
} from 'lucide-react';

export function HomePage() {
  return (
    <div className="home-page">
      <section className="home-hero">
        <div className="home-intro">
          <p className="eyebrow">ENCONTROS QUE APROXIMAM</p>
          <h1>
            Conhecimento que conecta.
            <br />
            <span className="text-red-700">Encontros que ficam.</span>
          </h1>
          <p className="muted mt-5 max-w-lg text-base sm:text-lg">
            Sua liga, suas ideias e o próximo encontro. Um caminho simples do
            convite à participação.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link className="btn" to="/recuperar">
              <Ticket size={18} aria-hidden="true" /> Minha inscrição{' '}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link className="btn secondary" to="/login">
              Sou organizador <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <p className="mt-6 flex items-center gap-2 text-sm text-zinc-600">
            <Mail size={16} aria-hidden="true" /> Recebeu um convite? Abra o
            link do evento.
          </p>
        </div>
        <aside className="welcome-panel" aria-labelledby="welcome-title">
          <div className="welcome-icon">
            <CalendarDays size={26} aria-hidden="true" />
          </div>
          <p className="eyebrow">SEU ESPAÇO NA LIGA</p>
          <h2 id="welcome-title">
            Tudo começa
            <br />
            com um encontro.
          </h2>
          <p className="mt-4 text-sm leading-relaxed">
            Para quem participa. Para quem faz acontecer.
          </p>
          <div className="welcome-actions">
            <Link to="/recuperar">
              <Ticket size={19} aria-hidden="true" />
              <span>
                <strong>Já me inscrevi</strong>
                <small>Acesse seu link pessoal</small>
              </span>
              <ArrowUpRight size={18} aria-hidden="true" />
            </Link>
            <Link to="/login">
              <Users size={19} aria-hidden="true" />
              <span>
                <strong>Quero organizar</strong>
                <small>Entre no painel da sua liga</small>
              </span>
              <ArrowUpRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </aside>
      </section>
      <section className="participation-guide" aria-labelledby="guide-title">
        <div className="guide-heading">
          <p className="eyebrow">DO CONVITE AO ENCONTRO</p>
          <h2 id="guide-title">Sua participação, em três passos.</h2>
        </div>
        <div className="guide-grid">
          {[
            [
              Ticket,
              '01',
              'Inscreva-se',
              'Abra o link do evento e preencha seus dados.',
            ],
            [
              CreditCard,
              '02',
              'Escolha como pagar',
              'Pix ou cartão, com processamento pelo Mercado Pago.',
            ],
            [
              CircleCheck,
              '03',
              'Acompanhe sua vaga',
              'Use o link pessoal enviado ao seu e-mail.',
            ],
          ].map(([Icon, number, title, text]) => {
            const I = Icon as typeof Ticket;
            return (
              <article className="guide-step" key={String(number)}>
                <div className="guide-step-top">
                  <I size={21} aria-hidden="true" />
                  <span>{String(number)}</span>
                </div>
                <h3>{String(title)}</h3>
                <p className="muted mt-2 text-sm leading-relaxed">
                  {String(text)}
                </p>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
