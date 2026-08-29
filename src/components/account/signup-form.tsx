"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useEffectEvent, useState } from "react";

import { signupAction, type FormState } from "@/app/(account)/auth-actions";
import { PasswordRequirements } from "@/components/account/password-requirements";
import { FormSubmitButton } from "@/components/form-submit-button";
import type { Locale } from "@/lib/i18n";

const initialState: FormState = {};

type SignupAccountType = "BUSINESS_OWNER" | "GETTER" | "USER";

type SignupFormProps = {
  accountType: SignupAccountType;
  locale: Locale;
  redirectTo?: string;
};

export function SignupForm({ accountType, locale, redirectTo = "" }: SignupFormProps) {
  const [state, action] = useActionState(signupAction, initialState);
  const isBusinessSignup = accountType === "BUSINESS_OWNER";
  const isPartnerSignup = accountType === "GETTER";
  const showFullWidthTerms = isBusinessSignup || isPartnerSignup;
  const acceptedTermsValue = isBusinessSignup
    ? state.signupValues?.businessTermsAccepted
    : isPartnerSignup
      ? state.signupValues?.partnerTermsAccepted
      : false;
  const [acceptedTerms, setAcceptedTerms] = useState(Boolean(acceptedTermsValue));
  const [email, setEmail] = useState(state.signupValues?.email ?? "");
  const [username, setUsername] = useState(state.signupValues?.username ?? "");
  const [password, setPassword] = useState(state.signupValues?.password ?? "");
  const [confirmPassword, setConfirmPassword] = useState(
    state.signupValues?.confirmPassword ?? "",
  );
  const restoreSignupValues = useEffectEvent((signupValues: NonNullable<FormState["signupValues"]>) => {
    setAcceptedTerms(
      isBusinessSignup
        ? signupValues.businessTermsAccepted ?? false
        : isPartnerSignup
          ? signupValues.partnerTermsAccepted ?? false
          : false,
    );
    setEmail(signupValues.email ?? "");
    setUsername(signupValues.username ?? "");
    setPassword(signupValues.password ?? "");
    setConfirmPassword(signupValues.confirmPassword ?? "");
  });

  useEffect(() => {
    if (!state.signupValues) {
      return;
    }

    startTransition(() => {
      restoreSignupValues(state.signupValues!);
    });
  }, [state.signupValues]);
  const copy =
    locale === "it"
      ? {
          businessLegal:
            "Creando un account, riconosci che questo costituisce un accordo legalmente vincolante tra te (o la tua attivita) e Salento Local.",
          businessTermsAcceptance:
            "Ho letto e accetto i Termini e Condizioni per le Attivita Commerciali di Salento Local.",
          businessTermsIntro:
            "Prima di creare un Account Business o rivendicare una scheda attivita, leggi attentamente quanto segue:",
          businessTermsTitle: "Termini e Condizioni per le Attivita Commerciali di Salento Local",
          cta: "Crea account",
          confirmPassword: "Conferma password",
          email: "Email",
          helper: "Hai gia un account?",
          jumpToTerms: "Leggi i termini richiesti qui sotto",
          login: "Accedi",
          password: "Password",
          pending: "Creazione account...",
          reviewTerms:
            "Prima di creare l'account devi leggere questi termini e selezionare la casella di accettazione.",
          reviewTermsTitle: "Passaggio obbligatorio",
          submitLocked: "Il pulsante si attiva solo dopo l'accettazione dei termini.",
          termsAcceptance:
            "Ho letto e accetto i Termini e Condizioni del Partner Salento Local.",
          termsIntro:
            "Prima di creare il tuo account Partner, leggi attentamente quanto segue:",
          termsTitle: "Termini e Condizioni del Partner Salento Local",
          username: "Username",
          usernameHint:
            "Scegli uno username unico. Potrai accedere in seguito sia con username e password sia con email e password.",
        }
      : {
          businessLegal:
            "By creating an account, you acknowledge that this is a legally binding agreement between you (or your business) and Salento Local.",
          businessTermsAcceptance:
            "I have read and agree to the Salento Local Business Terms & Conditions.",
          businessTermsIntro:
            "Before creating a Business Account or claiming a business listing, please read the following:",
          businessTermsTitle: "Salento Local Business Terms & Conditions",
          cta: "Create account",
          confirmPassword: "Confirm password",
          email: "Email",
          helper: "Already have an account?",
          jumpToTerms: "Read the required terms below",
          businessOwner: "I own a business and want to add it myself",
          login: "Log in",
          password: "Password",
          pending: "Creating account...",
          reviewTerms:
            "Before creating your account, you need to read these terms and tick the acceptance box.",
          reviewTermsTitle: "Required step",
          submitLocked: "The button unlocks only after you accept the terms.",
          termsAcceptance:
            "I have read and agree to the Salento Local Partner Terms & Conditions.",
          termsIntro: "Before creating your Partner account, please read the following:",
          termsTitle: "Salento Local Partner Terms & Conditions",
          username: "Username",
          usernameHint:
            "Choose a unique username. Later you can log in with either your username and password or your email and password.",
        };
  const businessTerms =
    locale === "it"
      ? [
          "Confermi di avere almeno 18 anni e di essere il proprietario dell'attivita oppure di avere l'autorita legale per gestirla e rappresentarla.",
          "Ti impegni a fornire informazioni accurate, complete e aggiornate sulla tua attivita, inclusi recapiti, orari di apertura, posizione, descrizioni, prezzi ove applicabili e qualsiasi altra informazione inviata tramite la piattaforma.",
          "Confermi di essere il proprietario o di avere il diritto di utilizzare tutte le fotografie, i loghi, i marchi e gli altri contenuti caricati. Concedi a Salento Local il permesso di mostrarli sulla piattaforma al solo scopo di promuovere la tua attivita.",
          "I costi dell'abbonamento sono indicati durante il pagamento. Salvo diversa indicazione, l'abbonamento e valido per un anno dalla data di attivazione. Per mantenere attiva la scheda potrebbero essere applicati costi di rinnovo.",
          "Tutti i pagamenti devono essere effettuati direttamente tramite Salento Local utilizzando i metodi di pagamento approvati. La scheda non sara pubblicata ne attivata fino alla conferma dell'avvenuto pagamento.",
          "Salvo quanto previsto dalla legge applicabile, le quote di abbonamento non sono rimborsabili dopo l'attivazione della scheda.",
          "Salento Local fornisce una piattaforma online di promozione e directory. Pur impegnandoci a garantire la massima visibilita possibile, non garantiamo richieste di contatto, prenotazioni, vendite, traffico sul sito, posizionamento nei motori di ricerca o risultati economici.",
          "Puoi aggiornare in qualsiasi momento le informazioni della tua attivita tramite il tuo account. Salento Local puo apportare piccole modifiche di formattazione, ortografia, traduzione o impaginazione per mantenere una presentazione coerente e professionale senza alterare il significato dei contenuti.",
          "Sei responsabile della sicurezza del tuo account e delle tue credenziali di accesso. Qualsiasi attivita effettuata tramite il tuo account e sotto la tua responsabilita.",
          "Salento Local si riserva il diritto di esaminare, approvare, rifiutare, sospendere o rimuovere qualsiasi scheda che contenga informazioni false o ingannevoli, violi i diritti di terzi, non rispetti le leggi applicabili o violi i presenti Termini e Condizioni.",
          "Puoi chiudere il tuo account in qualsiasi momento. La chiusura dell'account non da automaticamente diritto al rimborso delle quote di abbonamento gia pagate.",
          "I tuoi dati personali saranno trattati in conformita con la nostra Informativa sulla Privacy e con la normativa vigente in materia di protezione dei dati personali.",
          "Salento Local puo aggiornare i presenti Termini e Condizioni in qualsiasi momento. Continuando a utilizzare il tuo account o la tua scheda dopo l'entrata in vigore delle modifiche, accetti automaticamente i Termini aggiornati.",
          "I presenti Termini e Condizioni sono regolati dalle leggi della Repubblica Italiana.",
        ]
      : [
          "You confirm that you are at least 18 years old and are the owner of the business, or have the legal authority to manage and represent it.",
          "You agree to provide accurate, complete, and up-to-date information about your business, including contact details, opening hours, location, descriptions, pricing where applicable, and any other information submitted through the platform.",
          "You confirm that you own or have permission to use all photographs, logos, trademarks, and other content you upload. You grant Salento Local permission to display this content on the platform for the purpose of promoting your business.",
          "Membership fees are displayed during checkout. Unless otherwise stated, your membership is valid for one year from the date of activation. Renewal fees may apply to continue your listing after the initial membership period.",
          "All payments must be made directly through Salento Local using approved payment methods. Your listing will not be published or activated until payment has been successfully received.",
          "Unless otherwise required by applicable law, membership fees are non-refundable once your listing has been activated.",
          "Salento Local provides an online directory and promotional platform. While we work to maximize visibility, we do not guarantee customer enquiries, bookings, sales, website traffic, search rankings, or financial results.",
          "You may update your business information through your account at any time. Salento Local may make minor formatting, spelling, translation, or layout changes to maintain a consistent and professional presentation without changing the meaning of your content.",
          "You are responsible for maintaining the security of your account and login credentials. Any activity carried out using your account is your responsibility.",
          "Salento Local reserves the right to review, approve, reject, suspend, or remove any listing that contains false or misleading information, infringes the rights of others, violates applicable laws, or breaches these Terms & Conditions.",
          "You may close your account at any time. Closing your account does not automatically entitle you to a refund of any membership fees already paid.",
          "Your personal information will be processed in accordance with our Privacy Policy and applicable data protection laws.",
          "Salento Local may update these Terms & Conditions from time to time. Continued use of your account or listing after changes become effective constitutes acceptance of the updated Terms.",
          "These Terms & Conditions are governed by the laws of the Republic of Italy.",
        ];
  const terms =
    locale === "it"
      ? [
          "Partecipi a Salento Local come Partner Locale indipendente. Non sei un dipendente ne un rappresentante di Salento Local.",
          "Sei libero di scegliere quando, dove e con quale frequenza partecipare.",
          "Ti impegni a rappresentare Salento Local in modo onesto, professionale e rispettoso.",
          "Non fornirai informazioni false o fuorvianti alle attivita commerciali e non farai promesse non autorizzate.",
          "Non sei autorizzato a riscuotere pagamenti, accettare contanti, negoziare prezzi o concludere accordi per conto di Salento Local.",
          "Ti impegni a registrare esclusivamente attivita commerciali reali e a fornire informazioni accurate.",
          "Caricherai soltanto fotografie, loghi o altri contenuti per i quali possiedi i necessari diritti o autorizzazioni.",
          "Ti impegni a rispettare tutte le leggi applicabili durante l'utilizzo della piattaforma.",
          "Puoi ricevere una commissione di 50 EUR per ogni attivita commerciale idonea che completa con successo il pagamento e soddisfa i requisiti previsti dal Programma Partner di Salento Local.",
          "L'invio di un'attivita commerciale non garantisce il diritto alla commissione. Salento Local puo rifiutare o annullare le commissioni relative a registrazioni duplicate, fraudolente, rimborsate, inesatte o non idonee.",
          "Le commissioni vengono pagate in modo sicuro tramite il tuo account Stripe collegato. E tua responsabilita mantenere aggiornati i dati necessari per ricevere i pagamenti.",
          "Salento Local puo sospendere o chiudere definitivamente gli account Partner che violano i presenti Termini o utilizzano la piattaforma in modo improprio.",
          "Salento Local puo modificare in qualsiasi momento i presenti Termini o il Programma Partner. Continuando a utilizzare il tuo account, accetti automaticamente eventuali aggiornamenti.",
        ]
      : [
          "You are joining Salento Local as an independent Local Partner. You are not an employee or representative of Salento Local.",
          "You are free to choose when, where, and how often you participate.",
          "You agree to represent Salento Local honestly, professionally, and respectfully at all times.",
          "You will not mislead businesses, make unauthorized promises, or use aggressive sales practices.",
          "You are not authorized to collect payments, accept cash, negotiate pricing, or enter into agreements on behalf of Salento Local.",
          "You agree to submit only genuine businesses and provide accurate information.",
          "You will only upload photographs, logos, or other content that you have permission to use.",
          "You agree to comply with all applicable laws while using the platform.",
          "You may earn a commission of EUR50 for each eligible business that successfully completes payment and meets the requirements of the Salento Local Partner Program.",
          "Submitting a business does not guarantee a commission. Salento Local may refuse or cancel commissions for duplicate, fraudulent, refunded, inaccurate, or otherwise ineligible submissions.",
          "Commission payments are made securely through your connected Stripe account. You are responsible for keeping your payout information up to date.",
          "Salento Local may suspend or permanently remove Partner accounts that violate these Terms or misuse the platform.",
          "Salento Local may update these Terms or the Partner Program from time to time. Continued use of your account means you accept any updated Terms.",
        ];
  const termsConfirmation =
    locale === "it"
      ? "Selezionando la casella qui sotto, confermi di aver letto, compreso e accettato i presenti Termini e Condizioni. Creando un account, riconosci che questo costituisce un accordo legalmente vincolante tra te o la tua attivita e Salento Local."
      : "By checking the box below, you confirm that you have read, understood, and agree to these Terms & Conditions. By creating an account, you acknowledge that this is a legally binding agreement between you or your business and Salento Local.";
  const partnerTermsLead =
    locale === "it"
      ? "Registrandoti come Partner di Salento Local, accetti quanto segue:"
      : "By joining Salento Local as a Local Partner, you agree to the following:";
  const businessTermsLead =
    locale === "it"
      ? "Creando un Account Business o rivendicando una scheda attivita su Salento Local, accetti quanto segue:"
      : "By creating a Business Account or claiming a business listing on Salento Local, you agree to the following:";

  const fieldMarkup = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="accountType" value={accountType} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <label className="field-label">
        <span>{copy.email}</span>
        <input
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="input-field"
        />
        {state.fieldErrors?.email ? (
          <span className="text-sm text-[var(--accent)]">{state.fieldErrors.email}</span>
        ) : null}
      </label>
      {isPartnerSignup ? null : (
        <label className="field-label">
          <span>{copy.username}</span>
          <input
            name="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="input-field"
          />
          <span className="text-sm text-[var(--muted)]">{copy.usernameHint}</span>
          {state.fieldErrors?.username ? (
            <span className="text-sm text-[var(--accent)]">{state.fieldErrors.username}</span>
          ) : null}
        </label>
      )}
      <label className="field-label">
        <span>{copy.password}</span>
        <input
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="input-field"
        />
        {state.fieldErrors?.password ? (
          <span className="text-sm text-[var(--accent)]">{state.fieldErrors.password}</span>
        ) : null}
      </label>
      <PasswordRequirements locale={locale} password={password} />
      {isPartnerSignup ? (
        <label className="field-label">
          <span>{copy.confirmPassword}</span>
          <input
            name="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="input-field"
          />
          {state.fieldErrors?.confirmPassword ? (
            <span className="text-sm text-[var(--accent)]">{state.fieldErrors.confirmPassword}</span>
          ) : null}
        </label>
      ) : null}
      {showFullWidthTerms ? (
        <div className="rounded-[1.5rem] border border-[color:rgba(191,91,42,0.18)] bg-[linear-gradient(135deg,rgba(255,248,243,0.96),rgba(255,255,255,0.96))] px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            {copy.reviewTermsTitle}
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--foreground)]">{copy.reviewTerms}</p>
          <a
            href="#signup-terms"
            className="mt-4 inline-flex text-sm font-medium text-[var(--primary)] underline-offset-4 hover:underline"
          >
            {copy.jumpToTerms}
          </a>
        </div>
      ) : null}
      {state.error ? <p className="text-sm text-[var(--accent)]">{state.error}</p> : null}
      {showFullWidthTerms ? null : (
        <FormSubmitButton className="btn-primary w-full" pendingLabel={copy.pending}>
          {copy.cta}
        </FormSubmitButton>
      )}

      <p className="text-sm text-[var(--muted)]">
        {copy.helper}{" "}
        <Link
          href={redirectTo ? `/login?redirectTo=${encodeURIComponent(redirectTo)}` : "/login"}
          className="font-medium text-[var(--primary)]"
        >
          {copy.login}
        </Link>
      </p>
    </>
  );

  const termsMarkup = isPartnerSignup ? (
    <div
      id="signup-terms"
      className="mx-auto w-full max-w-4xl scroll-mt-28 rounded-[1.75rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.64)] p-6 sm:p-8"
    >
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
        {copy.termsTitle}
      </p>
      <p className="mt-3 text-sm leading-6 text-[var(--foreground)]">{copy.termsIntro}</p>
      <p className="mt-3 text-sm leading-6 text-[var(--foreground)]">{partnerTermsLead}</p>
      <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-6 text-[var(--foreground)]">
        {terms.map((term) => (
          <li key={term}>{term}</li>
        ))}
      </ol>
      <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{termsConfirmation}</p>
      <div className="mt-5 rounded-[1.4rem] border border-[color:rgba(42,98,87,0.16)] bg-white px-5 py-4">
        <label className="flex items-start gap-3 text-sm leading-6 text-[var(--foreground)]">
          <input
            type="checkbox"
            name="partnerTermsAccepted"
            checked={acceptedTerms}
            onChange={(event) => setAcceptedTerms(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border border-[var(--border)] accent-[var(--primary)]"
          />
          <span>{copy.termsAcceptance}</span>
        </label>
        {state.fieldErrors?.partnerTermsAccepted ? (
          <span className="mt-3 block text-sm text-[var(--accent)]">
            {state.fieldErrors.partnerTermsAccepted}
          </span>
        ) : null}
        <p className="mt-3 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
          {copy.submitLocked}
        </p>
        <FormSubmitButton
          className="btn-primary mt-4 w-full disabled:cursor-not-allowed disabled:opacity-55"
          disabled={!acceptedTerms}
          pendingLabel={copy.pending}
        >
          {copy.cta}
        </FormSubmitButton>
      </div>
    </div>
  ) : isBusinessSignup ? (
    <div
      id="signup-terms"
      className="mx-auto w-full max-w-4xl scroll-mt-28 rounded-[1.75rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.64)] p-6 sm:p-8"
    >
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
        {copy.businessTermsTitle}
      </p>
      <p className="mt-3 text-sm leading-6 text-[var(--foreground)]">{copy.businessTermsIntro}</p>
      <p className="mt-3 text-sm leading-6 text-[var(--foreground)]">{businessTermsLead}</p>
      <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-6 text-[var(--foreground)]">
        {businessTerms.map((term) => (
          <li key={term}>{term}</li>
        ))}
      </ol>
      <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{termsConfirmation}</p>
      <div className="mt-5 rounded-[1.4rem] border border-[color:rgba(42,98,87,0.16)] bg-white px-5 py-4">
        <label className="flex items-start gap-3 text-sm leading-6 text-[var(--foreground)]">
          <input
            type="checkbox"
            name="businessTermsAccepted"
            checked={acceptedTerms}
            onChange={(event) => setAcceptedTerms(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border border-[var(--border)] accent-[var(--primary)]"
          />
          <span>{copy.businessTermsAcceptance}</span>
        </label>
        {state.fieldErrors?.businessTermsAccepted ? (
          <span className="mt-3 block text-sm text-[var(--accent)]">
            {state.fieldErrors.businessTermsAccepted}
          </span>
        ) : null}
        <p className="mt-3 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
          {copy.submitLocked}
        </p>
        <FormSubmitButton
          className="btn-primary mt-4 w-full disabled:cursor-not-allowed disabled:opacity-55"
          disabled={!acceptedTerms}
          pendingLabel={copy.pending}
        >
          {copy.cta}
        </FormSubmitButton>
      </div>
    </div>
  ) : null;

  if (showFullWidthTerms) {
    return (
      <form action={action} className="contents">
        <section className="card p-8 lg:col-start-2">
          <div className="grid gap-4">{fieldMarkup}</div>
        </section>
        <section className="card p-4 sm:p-6 lg:col-span-2">{termsMarkup}</section>
      </form>
    );
  }

  return (
    <section className="card p-8">
      <form action={action} className="grid gap-4">
        {fieldMarkup}
      </form>
    </section>
  );
}
