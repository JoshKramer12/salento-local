import type { Locale } from "@/lib/i18n";

// Draft legal texts and placeholders in this file require review by an Italian lawyer,
// privacy professional, and where relevant a commercialista before production launch.

export const LEGAL_PLACEHOLDERS = {
  businessContactEmail: "[BUSINESS CONTACT EMAIL]",
  dataRetentionPeriod: "[DATA RETENTION PERIOD]",
  legalBusinessName: "[LEGAL BUSINESS NAME]",
  partitaIva: "[PARTITA IVA]",
  privacyContactEmail: "[PRIVACY CONTACT EMAIL]",
  registeredAddress: "[REGISTERED ADDRESS]",
} as const;

export const LEGAL_ROUTES = {
  cookies: "/cookies",
  privacy: "/privacy",
  terms: "/terms",
} as const;

export const LEGAL_DOCUMENTS = {
  businessTerms: {
    lastUpdated: "2026-09-14",
    version: "business-terms-2026-09-14",
  },
  cookiePolicy: {
    lastUpdated: "2026-07-14",
    version: "cookie-policy-2026-07-14",
  },
  partnerTerms: {
    lastUpdated: "2026-07-14",
    version: "partner-terms-2026-09-14",
  },
  privacyPolicy: {
    lastUpdated: "2026-07-14",
    version: "privacy-policy-2026-07-14",
  },
  platformTerms: {
    lastUpdated: "2026-07-14",
    version: "platform-terms-2026-07-14",
  },
} as const;

export type LegalAudience = "business" | "partner";

export type LegalSection = {
  bullets?: string[];
  id: string;
  paragraphs?: string[];
  title: string;
};

export type CookieTableRow = {
  category: string;
  consentRequired: string;
  duration: string;
  name: string;
  provider: string;
  purpose: string;
};

export function formatLegalDate(locale: Locale, value: string) {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function getLegalPageLabels(locale: Locale) {
  if (locale === "it") {
    return {
      backToSite: "Torna al sito",
      cookiePolicy: "Cookie Policy",
      lastUpdated: "Ultimo aggiornamento",
      privacyPolicy: "Informativa sulla Privacy",
      terms: "Termini e Condizioni",
      version: "Versione",
    };
  }

  return {
    backToSite: "Return to site",
    cookiePolicy: "Cookie Policy",
    lastUpdated: "Last updated",
    privacyPolicy: "Privacy Policy",
    terms: "Terms & Conditions",
    version: "Version",
  };
}

export function getLegalLinks(locale: Locale) {
  const labels = getLegalPageLabels(locale);

  return {
    cookies: {
      href: LEGAL_ROUTES.cookies,
      label: labels.cookiePolicy,
    },
    privacy: {
      href: LEGAL_ROUTES.privacy,
      label: labels.privacyPolicy,
    },
    terms: {
      href: LEGAL_ROUTES.terms,
      label: labels.terms,
    },
  };
}

export function getAudienceTermsLink(locale: Locale, audience: LegalAudience) {
  if (audience === "partner") {
    return {
      href: `${LEGAL_ROUTES.terms}#partner-terms`,
      label:
        locale === "it"
          ? "Termini e Condizioni del Partner"
          : "Partner Terms & Conditions",
    };
  }

  return {
    href: `${LEGAL_ROUTES.terms}#business-terms`,
    label:
      locale === "it"
        ? "Termini e Condizioni per le Attivita Commerciali"
        : "Business Terms & Conditions",
  };
}

export function getRequiredLegalDocuments(audience: LegalAudience) {
  if (audience === "partner") {
    return [
      {
        documentType: "PARTNER_TERMS" as const,
        version: LEGAL_DOCUMENTS.partnerTerms.version,
      },
      {
        documentType: "PRIVACY_POLICY" as const,
        version: LEGAL_DOCUMENTS.privacyPolicy.version,
      },
      {
        documentType: "COOKIE_POLICY" as const,
        version: LEGAL_DOCUMENTS.cookiePolicy.version,
      },
    ];
  }

  return [
    {
      documentType: "BUSINESS_TERMS" as const,
      version: LEGAL_DOCUMENTS.businessTerms.version,
    },
    {
      documentType: "PRIVACY_POLICY" as const,
      version: LEGAL_DOCUMENTS.privacyPolicy.version,
    },
    {
      documentType: "COOKIE_POLICY" as const,
      version: LEGAL_DOCUMENTS.cookiePolicy.version,
    },
  ];
}

export function getBusinessTerms(locale: Locale) {
  if (locale === "it") {
    return [
      "Confermi di avere almeno 18 anni e di essere il proprietario dell'attivita oppure di avere l'autorita legale per gestirla e rappresentarla.",
      "Ti impegni a fornire informazioni accurate, complete e aggiornate sulla tua attivita, inclusi recapiti, orari di apertura, posizione, descrizioni, prezzi ove applicabili e qualsiasi altra informazione inviata tramite la piattaforma.",
      "Confermi di essere il proprietario o di avere il diritto di utilizzare tutte le fotografie, i loghi, i marchi e gli altri contenuti caricati. Concedi a Salento Local il permesso di mostrarli sulla piattaforma al solo scopo di promuovere la tua attivita.",
      "La membership viene acquistata separatamente per ogni attivita. Costa EUR100 per ciascuna attivita e per ogni periodo annuale: ogni pagamento riuscito attiva la pagina specifica per 365 giorni. Dopo un periodo non pagato seguono 14 giorni di grazia; successivamente la pagina puo essere rimossa dalla visibilita pubblica mentre i dati restano conservati per una possibile riattivazione. L'accesso dell'account e alla gestione resta disponibile anche dopo la scadenza.",
      "Il rinnovo puo essere automatico o manuale in base alla preferenza di rinnovo scelta dal titolare. Il titolare puo disattivare futuri rinnovi automatici senza interrompere il periodo gia pagato. I dettagli dell'eventuale addebito ricorrente saranno mostrati prima dell'autorizzazione; rimborsi e contestazioni possono incidere sullo stato della membership.",
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
    ];
  }

  return [
    "You confirm that you are at least 18 years old and are the owner of the business, or have the legal authority to manage and represent it.",
    "You agree to provide accurate, complete, and up-to-date information about your business, including contact details, opening hours, location, descriptions, pricing where applicable, and any other information submitted through the platform.",
    "You confirm that you own or have permission to use all photographs, logos, trademarks, and other content you upload. You grant Salento Local permission to display this content on the platform for the purpose of promoting your business.",
    "Membership is purchased separately for each business. It costs EUR100 per business for each annual term: each successful payment activates that specific Business Page for 365 days. An unpaid term is followed by a 14-day grace period; after that, the page may be removed from public visibility while its data remains stored for possible reactivation. Account and management access remain available after expiry.",
    "Renewal may ultimately be automatic or manual according to the owner’s selected renewal preference. An owner may disable future automatic renewal without ending an already-paid term. Details of any recurring charge will be shown before recurring billing is authorized; refunds and chargebacks may affect membership status.",
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
}

export function getPartnerTerms(locale: Locale) {
  if (locale === "it") {
    return [
      "Partecipi a Salento Local come Partner Locale indipendente. Non sei un dipendente ne un rappresentante di Salento Local.",
      "Sei libero di scegliere quando, dove e con quale frequenza partecipare.",
      "Ti impegni a rappresentare Salento Local in modo onesto, professionale e rispettoso.",
      "Non fornirai informazioni false o fuorvianti alle attivita commerciali e non farai promesse non autorizzate.",
      "Non sei autorizzato a riscuotere pagamenti, accettare contanti, negoziare prezzi o concludere accordi per conto di Salento Local.",
      "Ti impegni a registrare esclusivamente attivita commerciali reali e a fornire informazioni accurate.",
      "Caricherai soltanto fotografie, loghi o altri contenuti per i quali possiedi i necessari diritti o autorizzazioni.",
      "Ti impegni a rispettare tutte le leggi applicabili durante l'utilizzo della piattaforma.",
      "Puoi ricevere una commissione di 50 EUR per ogni attivita commerciale idonea che origini e che completa con successo il pagamento. Per ogni successivo rinnovo annuale o riattivazione pagata con successo della stessa membership, il Partner originario puo ricevere 15 EUR.",
      "L'invio di un'attivita commerciale non garantisce il diritto alla commissione, ne un reddito futuro. Nessuna commissione di rinnovo e dovuta se l'attivita non paga. Salento Local puo rifiutare, stornare o annullare le commissioni per registrazioni duplicate, fraudolente, rimborsate, contestate, inesatte, violazioni del programma o non idonee.",
      "Le commissioni vengono pagate in modo sicuro tramite il tuo account Stripe collegato. E tua responsabilita mantenere aggiornati i dati necessari per ricevere i pagamenti.",
      "Salento Local puo sospendere o chiudere definitivamente gli account Partner che violano i presenti Termini o utilizzano la piattaforma in modo improprio.",
      "Salento Local puo modificare in qualsiasi momento i presenti Termini o il Programma Partner. Continuando a utilizzare il tuo account, accetti automaticamente eventuali aggiornamenti.",
    ];
  }

  return [
    "You are joining Salento Local as an independent Local Partner. You are not an employee or representative of Salento Local.",
    "You are free to choose when, where, and how often you participate.",
    "You agree to represent Salento Local honestly, professionally, and respectfully at all times.",
    "You will not mislead businesses, make unauthorized promises, or use aggressive sales practices.",
    "You are not authorized to collect payments, accept cash, negotiate pricing, or enter into agreements on behalf of Salento Local.",
    "You agree to submit only genuine businesses and provide accurate information.",
    "You will only upload photographs, logos, or other content that you have permission to use.",
    "You agree to comply with all applicable laws while using the platform.",
    "You may earn EUR50 for each eligible business you originate that successfully completes payment. For each later successful annual renewal or reactivation of that same membership, the originating Partner may earn EUR15.",
    "Submitting a business does not guarantee a commission or future income. No renewal commission is due unless the business pays. Salento Local may administer eligibility and refuse, reverse, or cancel commissions for duplicate, fraudulent, refunded, disputed, inaccurate, program-violating, or otherwise ineligible submissions.",
    "Commission payments are made securely through your connected Stripe account. You are responsible for keeping your payout information up to date.",
    "Salento Local may suspend or permanently remove Partner accounts that violate these Terms or misuse the platform.",
    "Salento Local may update these Terms or the Partner Program from time to time. Continued use of your account means you accept any updated Terms.",
  ];
}

export function getTermsDocument(locale: Locale) {
  const generalContactLine =
    locale === "it"
      ? `${LEGAL_PLACEHOLDERS.legalBusinessName}, ${LEGAL_PLACEHOLDERS.registeredAddress}, Partita IVA ${LEGAL_PLACEHOLDERS.partitaIva}, email: ${LEGAL_PLACEHOLDERS.businessContactEmail}.`
      : `${LEGAL_PLACEHOLDERS.legalBusinessName}, ${LEGAL_PLACEHOLDERS.registeredAddress}, VAT no. ${LEGAL_PLACEHOLDERS.partitaIva}, email: ${LEGAL_PLACEHOLDERS.businessContactEmail}.`;

  const sections: LegalSection[] =
    locale === "it"
      ? [
          {
            id: "about",
            paragraphs: [
              `Salento Local e una piattaforma online gestita da ${generalContactLine}`,
              "La piattaforma aiuta utenti, attivita commerciali e Partner locali a pubblicare, gestire e promuovere schede relative al territorio del Salento.",
            ],
            title: "1. Informazioni su Salento Local",
          },
          {
            id: "acceptance",
            paragraphs: [
              "Utilizzando il sito, creando un account, inviando una scheda, rivendicando un'attivita oppure partecipando al programma Partner, accetti i presenti Termini e Condizioni e le eventuali regole specifiche applicabili al tuo tipo di account.",
              "Se non accetti questi Termini, non devi utilizzare i servizi che li richiedono.",
            ],
            title: "2. Accettazione dei termini",
          },
          {
            id: "eligibility",
            paragraphs: [
              "Per creare un account che consente di pubblicare, rivendicare o gestire schede devi avere almeno 18 anni e poter concludere accordi vincolanti per te o per l'attivita che rappresenti.",
              "Le attivita commerciali e i Partner locali devono fornire dati accurati, completi e aggiornati durante la registrazione e l'utilizzo del servizio.",
            ],
            title: "3. Requisiti di idoneita e registrazione account",
          },
          {
            id: "security",
            paragraphs: [
              "Sei responsabile della riservatezza delle tue credenziali di accesso e di tutte le attivita svolte tramite il tuo account.",
              "Devi avvisarci tempestivamente se sospetti accessi non autorizzati o uso improprio del tuo account.",
            ],
            title: "4. Sicurezza dell'account",
          },
          {
            id: "listings",
            paragraphs: [
              "Le informazioni inviate per una scheda devono essere veritiere, non fuorvianti e sufficienti a consentire una presentazione corretta dell'attivita.",
              "Possiamo verificare, riformattare, tradurre o adattare lievemente i contenuti inviati per esigenze di chiarezza, coerenza editoriale e qualita della piattaforma, senza alterarne in modo sostanziale il significato.",
            ],
            title: "5. Schede attivita e informazioni inviate",
          },
          {
            id: "partners",
            paragraphs: [
              "I Partner locali partecipano come collaboratori indipendenti e non come dipendenti, agenti o rappresentanti autorizzati di Salento Local.",
              "I Partner non possono riscuotere contanti, accettare pagamenti, negoziare prezzi o concludere accordi per conto di Salento Local.",
            ],
            title: "6. Partecipazione dei Partner locali",
          },
          {
            id: "payments",
            paragraphs: [
              "La membership viene acquistata separatamente per ogni attivita commerciale. Il prezzo e EUR100 per attivita e per ogni periodo annuale; ogni pagamento riuscito attiva esclusivamente la pagina dell'attivita interessata per 365 giorni.",
              "A un periodo non pagato seguono 14 giorni di grazia. Dopo tale periodo, la pagina puo essere rimossa dalla visibilita pubblica mentre i dati restano disponibili per una possibile riattivazione e il titolare mantiene l'accesso al proprio account e agli strumenti di gestione.",
              "Il rinnovo potra essere automatico o manuale secondo la preferenza selezionata dal titolare. Il titolare puo disattivare il rinnovo automatico futuro senza interrompere un periodo gia pagato. I dettagli di ogni addebito ricorrente saranno mostrati prima dell'autorizzazione. Rimborsi e contestazioni possono incidere sullo stato della membership.",
            ],
            title: "7. Pagamenti, abbonamenti e periodi di membership",
          },
          {
            id: "commissions",
            paragraphs: [
              "Il Partner originario puo maturare 50 EUR quando un'attivita idonea aderisce e paga con successo, e 15 EUR per ogni rinnovo annuale o riattivazione successiva pagata con successo della stessa membership. Non e garantito alcun reddito futuro e non e dovuta alcuna commissione di rinnovo senza pagamento.",
              "Salento Local amministra l'idoneita del Programma Partner. Invii duplicati, fraudolenti, rimborsati, stornati, contestati, inaccurati, in violazione del programma o comunque non idonei possono non generare alcuna commissione oppure generare storni o rettifiche.",
              "Stripe puo essere utilizzato per i pagamenti delle schede, i controlli di identita, gli account payout collegati e i pagamenti delle commissioni ai Partner.",
            ],
            title: "8. Commissioni Partner e payout Stripe Connect",
          },
          {
            id: "refunds",
            paragraphs: [
              "Eventuali rimborsi, annullamenti o diritti di recesso saranno gestiti secondo i termini applicabili al servizio acquistato e alle leggi vigenti.",
              "Nulla nei presenti Termini esclude rimborsi o diritti di recesso quando richiesti dalla legge applicabile.",
            ],
            title: "9. Rimborsi e cancellazioni",
          },
          {
            id: "content",
            paragraphs: [
              "Caricando foto, loghi, descrizioni o altri contenuti, confermi di avere i diritti necessari o le autorizzazioni per il loro utilizzo.",
              "Non devi inviare contenuti illegali, diffamatori, ingannevoli o che violino diritti di terzi.",
            ],
            title: "10. Foto, loghi e contenuti forniti dagli utenti",
          },
          {
            id: "licence",
            paragraphs: [
              "Per la durata necessaria a fornire il servizio, concedi a Salento Local una licenza non esclusiva per ospitare, riprodurre, visualizzare, adattare e comunicare al pubblico i contenuti che invii, esclusivamente per gestire, promuovere e presentare la scheda o il servizio correlato.",
            ],
            title: "11. Permesso concesso a Salento Local per mostrare i contenuti",
          },
          {
            id: "prohibited",
            bullets: [
              "creare account o schede con dati falsi o impersonare terzi;",
              "usare la piattaforma per attivita fraudolente, illegali o ingannevoli;",
              "aggirare controlli tecnici, di verifica o di pagamento;",
              "raccogliere dati di altri utenti in modo non autorizzato;",
              "caricare contenuti che violano diritti di proprieta intellettuale o privacy.",
            ],
            title: "12. Condotte vietate",
          },
          {
            id: "review",
            paragraphs: [
              "Possiamo controllare, sospendere, rifiutare, rimuovere o limitare schede, account o transazioni quando riteniamo ragionevolmente che vi siano violazioni di questi Termini, rischi legali, problemi di pagamento, segnalazioni attendibili o esigenze operative della piattaforma.",
            ],
            title: "13. Revisione, sospensione e rimozione delle schede",
          },
          {
            id: "no-guarantee",
            paragraphs: [
              "Salento Local non garantisce richieste, prenotazioni, clienti, vendite, ranking nei motori di ricerca, visibilita, traffico, ricavi o risultati economici.",
            ],
            title: "14. Nessuna garanzia di risultati commerciali",
          },
          {
            id: "third-parties",
            paragraphs: [
              "Il servizio puo integrare o dipendere da servizi di terzi, inclusi Stripe, fornitori email, fornitori di verifica e altri strumenti tecnici.",
              "L'uso di tali servizi puo essere soggetto anche ai termini e alle informative dei rispettivi fornitori.",
            ],
            title: "15. Servizi di terzi, incluso Stripe",
          },
          {
            id: "ip",
            paragraphs: [
              "Il marchio Salento Local, il design della piattaforma, il software, i database originali, i testi proprietari e gli elementi distintivi del servizio restano di proprieta di Salento Local o dei suoi licenzianti.",
            ],
            title: "16. Proprietà intellettuale di Salento Local",
          },
          {
            id: "availability",
            paragraphs: [
              "Possiamo modificare, aggiornare, sospendere o interrompere parti del servizio, temporaneamente o definitivamente, per ragioni tecniche, legali, commerciali o operative.",
            ],
            title: "17. Disponibilita della piattaforma e modifiche",
          },
          {
            id: "liability",
            paragraphs: [
              "Nei limiti consentiti dalla legge applicabile, Salento Local non sara responsabile per perdite indirette, mancate opportunita, mancati profitti o danni consequenziali derivanti dall'uso della piattaforma.",
              "Nulla nei presenti Termini limita o esclude responsabilita che non possono essere escluse per legge.",
            ],
            title: "18. Limitazione di responsabilita",
          },
          {
            id: "termination",
            paragraphs: [
              "Puoi smettere di usare il servizio e chiudere il tuo account in qualsiasi momento, ferma restando l'eventuale sopravvivenza di obblighi gia maturati.",
              "Possiamo sospendere o chiudere un account in caso di violazioni, rischi operativi, problemi di pagamento o obblighi legali.",
            ],
            title: "19. Chiusura account e risoluzione",
          },
          {
            id: "changes",
            paragraphs: [
              "Possiamo aggiornare questi Termini. Quando una modifica e materiale, potremo indicare una nuova versione e richiedere una nuova accettazione nei punti del servizio in cui cio risulti opportuno.",
            ],
            title: "20. Modifiche ai termini",
          },
          {
            id: "law",
            paragraphs: [
              "I presenti Termini sono regolati dalla legge italiana, fatti salvi eventuali diritti inderogabili previsti dalla normativa applicabile.",
            ],
            title: "21. Legge applicabile",
          },
          {
            id: "contact",
            paragraphs: [
              `Per domande commerciali o legali puoi contattarci a ${LEGAL_PLACEHOLDERS.businessContactEmail}.`,
              `Sede: ${LEGAL_PLACEHOLDERS.registeredAddress}. Partita IVA: ${LEGAL_PLACEHOLDERS.partitaIva}.`,
            ],
            title: "22. Contatti",
          },
          {
            id: "business-terms",
            bullets: getBusinessTerms(locale),
            paragraphs: [
              "Questi termini specifici si applicano alle attivita commerciali che creano un account, rivendicano una scheda o completano una membership a pagamento su Salento Local.",
            ],
            title: "Termini specifici per le Attivita Commerciali di Salento Local",
          },
          {
            id: "partner-terms",
            bullets: getPartnerTerms(locale),
            paragraphs: [
              "Questi termini specifici si applicano ai Partner locali che usano la piattaforma per proporre nuove attivita e maturare eventuali commissioni.",
            ],
            title: "Termini specifici del Partner Salento Local",
          },
        ]
      : [
          {
            id: "about",
            paragraphs: [
              `Salento Local is an online platform operated by ${generalContactLine}`,
              "The platform helps users, local businesses, and Local Partners publish, manage, and promote listings connected to the Salento area.",
            ],
            title: "1. About Salento Local",
          },
          {
            id: "acceptance",
            paragraphs: [
              "By using the website, creating an account, submitting a listing, claiming a business, or participating in the Partner program, you agree to these Terms & Conditions and any specific rules that apply to your account type.",
              "If you do not agree, you must not use the services that require acceptance of these terms.",
            ],
            title: "2. Acceptance of the terms",
          },
          {
            id: "eligibility",
            paragraphs: [
              "To create an account for publishing, claiming, or managing listings, you must be at least 18 years old and able to enter into binding agreements for yourself or the business you represent.",
              "Businesses and Local Partners must provide accurate, complete, and current information during registration and use of the service.",
            ],
            title: "3. Eligibility and account registration",
          },
          {
            id: "security",
            paragraphs: [
              "You are responsible for keeping your login credentials confidential and for activity carried out through your account.",
              "You must promptly notify us if you suspect unauthorized access or misuse.",
            ],
            title: "4. Account security",
          },
          {
            id: "listings",
            paragraphs: [
              "Information submitted for a listing must be truthful, not misleading, and sufficient for the business to be presented accurately.",
              "We may review, reformat, translate, or lightly adapt submitted content for clarity, editorial consistency, and platform quality, without materially changing its meaning.",
            ],
            title: "5. Business listings and submitted information",
          },
          {
            id: "partners",
            paragraphs: [
              "Local Partners participate as independent collaborators and not as employees, agents, or authorized representatives of Salento Local.",
              "Local Partners may not collect cash, accept payments, negotiate pricing, or enter into agreements on behalf of Salento Local.",
            ],
            title: "6. Local Partner participation",
          },
          {
            id: "payments",
            paragraphs: [
              "Membership is purchased separately for each business. The price is EUR100 per business for each annual term; each successful payment activates only the relevant Business Page for 365 days.",
              "An unpaid term is followed by a 14-day grace period. After that period, the Business Page may be removed from public visibility while its data remains available for possible reactivation, and the owner retains account and management access.",
              "Renewal may be automatic or manual according to the owner’s selected preference. An owner may disable future automatic renewal without ending an already-paid term. Details of any recurring charge will be shown before authorization. Refunds and chargebacks may affect membership status.",
            ],
            title: "7. Payments, subscriptions, and membership periods",
          },
          {
            id: "commissions",
            paragraphs: [
              "The originating Partner may earn EUR50 when an eligible business joins and successfully pays, and EUR15 for each later successful annual renewal or reactivation of that same membership. Future income is not guaranteed, and no renewal commission is due without payment.",
              "Salento Local administers Partner Program eligibility. Duplicate, fraudulent, refunded, reversed, disputed, inaccurate, program-violating, or otherwise ineligible submissions may generate no commission and may lead to reversals or adjustments.",
              "Stripe may be used for listing payments, identity checks, connected payout accounts, and Partner payouts.",
            ],
            title: "8. Partner commissions and Stripe Connect payouts",
          },
          {
            id: "refunds",
            paragraphs: [
              "Refunds, cancellations, or withdrawal rights will be handled according to the specific service purchased and applicable law.",
              "Nothing in these terms excludes refunds or withdrawal rights where required by applicable law.",
            ],
            title: "9. Refunds and cancellations",
          },
          {
            id: "content",
            paragraphs: [
              "When you upload photos, logos, descriptions, or other materials, you confirm that you have the necessary rights or permissions to use them.",
              "You must not submit unlawful, defamatory, misleading, or infringing content.",
            ],
            title: "10. User-provided photos, logos, and content",
          },
          {
            id: "licence",
            paragraphs: [
              "For the period necessary to provide the service, you grant Salento Local a non-exclusive licence to host, reproduce, display, adapt, and communicate submitted content to the public solely for managing, promoting, and presenting the listing or related service.",
            ],
            title: "11. Permission granted to Salento Local to display submitted content",
          },
          {
            id: "prohibited",
            bullets: [
              "creating accounts or listings with false information or impersonating others;",
              "using the platform for fraudulent, unlawful, or misleading conduct;",
              "circumventing verification, payment, or technical controls;",
              "collecting other users' information without authorization;",
              "uploading content that infringes intellectual-property or privacy rights.",
            ],
            title: "12. Prohibited conduct",
          },
          {
            id: "review",
            paragraphs: [
              "We may review, suspend, reject, remove, or limit listings, accounts, or transactions where we reasonably believe there is a breach of these terms, legal risk, payment issue, credible complaint, or operational need.",
            ],
            title: "13. Listing review, suspension, and removal",
          },
          {
            id: "no-guarantee",
            paragraphs: [
              "Salento Local does not guarantee enquiries, bookings, customers, sales, search rankings, visibility, traffic, revenue, or financial results.",
            ],
            title: "14. No guarantee of enquiries, visibility, rankings, or results",
          },
          {
            id: "third-parties",
            paragraphs: [
              "The service may integrate with or depend on third-party services, including Stripe, email providers, verification providers, and other technical tools.",
              "Use of those services may also be subject to the terms and policies of the relevant providers.",
            ],
            title: "15. Third-party services, including Stripe",
          },
          {
            id: "ip",
            paragraphs: [
              "The Salento Local brand, platform design, software, original databases, proprietary text, and distinctive service elements remain the property of Salento Local or its licensors.",
            ],
            title: "16. Intellectual property belonging to Salento Local",
          },
          {
            id: "availability",
            paragraphs: [
              "We may modify, update, suspend, or discontinue parts of the service temporarily or permanently for technical, legal, commercial, or operational reasons.",
            ],
            title: "17. Platform availability and changes",
          },
          {
            id: "liability",
            paragraphs: [
              "To the extent permitted by applicable law, Salento Local will not be liable for indirect losses, lost opportunities, lost profits, or consequential damages arising from use of the platform.",
              "Nothing in these terms limits or excludes liability that cannot legally be excluded.",
            ],
            title: "18. Limitation of liability",
          },
          {
            id: "termination",
            paragraphs: [
              "You may stop using the service and close your account at any time, subject to any obligations that have already arisen.",
              "We may suspend or terminate an account in the event of breaches, operational risk, payment issues, or legal obligations.",
            ],
            title: "19. Account closure and termination",
          },
          {
            id: "changes",
            paragraphs: [
              "We may update these terms. Where a future change is material, we may issue a new version and require renewed acceptance in relevant service flows.",
            ],
            title: "20. Changes to the terms",
          },
          {
            id: "law",
            paragraphs: [
              "These terms are governed by Italian law, without prejudice to any mandatory rights that cannot legally be excluded.",
            ],
            title: "21. Governing law",
          },
          {
            id: "contact",
            paragraphs: [
              `For business or legal questions, contact us at ${LEGAL_PLACEHOLDERS.businessContactEmail}.`,
              `Registered address: ${LEGAL_PLACEHOLDERS.registeredAddress}. VAT no.: ${LEGAL_PLACEHOLDERS.partitaIva}.`,
            ],
            title: "22. Contact details",
          },
          {
            id: "business-terms",
            bullets: getBusinessTerms(locale),
            paragraphs: [
              "These specific terms apply to businesses that create an account, claim a listing, or complete a paid membership on Salento Local.",
            ],
            title: "Salento Local Business Terms",
          },
          {
            id: "partner-terms",
            bullets: getPartnerTerms(locale),
            paragraphs: [
              "These specific terms apply to Local Partners who use the platform to introduce new businesses and potentially earn commissions.",
            ],
            title: "Salento Local Partner Terms",
          },
        ];

  return {
    sections,
    summary:
      locale === "it"
        ? "Questi Termini descrivono come funziona Salento Local per utenti, attivita commerciali e Partner locali."
        : "These terms explain how Salento Local works for users, businesses, and Local Partners.",
    title:
      locale === "it" ? "Termini e Condizioni" : "Terms & Conditions",
    version: LEGAL_DOCUMENTS.platformTerms.version,
  };
}

export function getPrivacyDocument(locale: Locale) {
  const sections: LegalSection[] =
    locale === "it"
      ? [
          {
            id: "controller",
            paragraphs: [
              `${LEGAL_PLACEHOLDERS.legalBusinessName}, con sede in ${LEGAL_PLACEHOLDERS.registeredAddress} e Partita IVA ${LEGAL_PLACEHOLDERS.partitaIva}, agisce come titolare del trattamento per i dati personali trattati tramite Salento Local.`,
              `Per richieste privacy puoi scrivere a ${LEGAL_PLACEHOLDERS.privacyContactEmail}. Per richieste commerciali o account puoi usare ${LEGAL_PLACEHOLDERS.businessContactEmail}.`,
            ],
            title: "1. Titolare del trattamento e contatti",
          },
          {
            id: "categories",
            bullets: [
              "dati account e autenticazione, come email, username, password cifrata, ruolo account e stato di verifica email;",
              "dati forniti dai Partner locali, come telefono, WhatsApp, comune di riferimento, data di nascita, lingua preferita, informazioni payout e stato Stripe Connect;",
              "dati forniti dai titolari di attivita, come nome, ruolo, email privata, telefono privato, dati della scheda e firma di autorizzazione;",
              "contenuti della scheda, foto caricate, descrizioni, orari, indirizzi, link social e dati di contatto pubblici o privati;",
              "dati di pagamento e payout, inclusi importi, stato pagamenti, riferimenti Stripe, commissioni Partner e dati payout correlati;",
              "dati di verifica, come codici monouso, canali di invio, timestamp, tentativi e stato della verifica;",
              "comunicazioni transazionali, come email di verifica, ricevute, messaggi di supporto operativo e notifiche legate ai payout;",
              "dati tecnici minimi necessari al funzionamento di sessioni, login, lingua selezionata e sicurezza applicativa.",
            ],
            title: "2. Categorie di dati personali trattati",
          },
          {
            id: "partner-data",
            paragraphs: [
              "Quando un Partner locale crea o completa il proprio account, possiamo trattare dati necessari per l'onboarding, il profilo operativo, la configurazione di Stripe Connect e la gestione delle commissioni.",
            ],
            title: "3. Informazioni fornite dai Partner locali",
          },
          {
            id: "business-owner-data",
            paragraphs: [
              "Quando un titolare crea un account business, rivendica una scheda o pubblica un'attivita, trattiamo i dati necessari per verificare la titolarita, gestire la scheda, processare il pagamento e fornire assistenza operativa.",
            ],
            title: "4. Informazioni fornite dai titolari di attivita",
          },
          {
            id: "auth",
            paragraphs: [
              "Salento Local usa autenticazione con email o username e password. Le password vengono memorizzate solo in forma hash e non in chiaro.",
            ],
            title: "5. Dati account e autenticazione",
          },
          {
            id: "listing-content",
            paragraphs: [
              "Le informazioni inserite nelle schede e nei flussi di pubblicazione includono contenuti descrittivi, recapiti, immagini, indirizzi, orari e informazioni private del proprietario o manager utilizzate per verifiche e follow-up interni.",
            ],
            title: "6. Dati della scheda e contenuti caricati",
          },
          {
            id: "payments",
            paragraphs: [
              "I pagamenti delle schede e i payout Partner possono essere gestiti tramite Stripe. Stripe puo trattare dati di pagamento, dati fiscali, controlli di identita, stato dell'account payout e metadati delle transazioni secondo la propria documentazione e informativa.",
            ],
            title: "7. Pagamenti e payout tramite Stripe",
          },
          {
            id: "communications",
            paragraphs: [
              "Possiamo inviare email di verifica, ricevute e altri messaggi transazionali tramite Resend oppure tramite il provider SMTP configurato nell'ambiente.",
              "Per codici di verifica via SMS o WhatsApp il progetto puo usare Twilio Verify, Twilio SMS oppure Meta WhatsApp Cloud API, se configurati.",
            ],
            title: "8. Comunicazioni, verifiche e ricevute",
          },
          {
            id: "technical",
            paragraphs: [
              "Il codice esaminato usa cookie di sessione/autenticazione, cookie lingua e altri dati tecnici minimi necessari. Non sono stati individuati nel codice strumenti di analytics, advertising o profiling non essenziali attivi di default.",
              "Il database applicativo esaminato non mostra una memorizzazione esplicita e sistematica di indirizzi IP o user-agent a livello applicativo; eventuali log infrastrutturali dipendono dall'ambiente di hosting e devono essere verificati separatamente prima del lancio.",
            ],
            title: "9. Dati tecnici, di sicurezza, di log, dispositivo e utilizzo",
          },
          {
            id: "cookies",
            paragraphs: [
              "Per maggiori dettagli sui cookie e tecnologie simili usate dal sito, consulta la Cookie Policy.",
            ],
            title: "10. Cookie e tecnologie simili",
          },
          {
            id: "purposes",
            bullets: [
              "creare e gestire account utente;",
              "pubblicare, verificare, modificare e amministrare schede attivita;",
              "gestire pagamenti, ricevute, commissioni e payout;",
              "eseguire verifiche di titolarita e prevenire abusi o frodi;",
              "rispondere a richieste operative o di supporto;",
              "mantenere sicurezza, integrita e continuita tecnica del servizio.",
            ],
            title: "11. Finalita del trattamento",
          },
          {
            id: "legal-bases",
            paragraphs: [
              "Trattiamo i dati personali principalmente per eseguire il contratto o misure precontrattuali richieste dall'utente, per adempiere obblighi legali, per perseguire legittimi interessi connessi alla sicurezza e gestione della piattaforma e, ove necessario, sulla base del consenso.",
            ],
            title: "12. Basi giuridiche ai sensi del GDPR",
          },
          {
            id: "contractual-necessity",
            paragraphs: [
              "Molti dati richiesti nei flussi account, claim, pubblicazione, pagamento e payout sono necessari per fornirti il servizio richiesto. Se non li fornisci, potremmo non poter creare o mantenere il servizio interessato.",
            ],
            title: "13. Necessita contrattuale",
          },
          {
            id: "legal-obligations",
            paragraphs: [
              "Alcuni dati possono essere trattati per adempimenti contabili, fiscali, antifrode, sicurezza, risposta a richieste delle autorita o altri obblighi previsti dalla legge.",
            ],
            title: "14. Obblighi legali",
          },
          {
            id: "legitimate-interests",
            paragraphs: [
              "I nostri legittimi interessi includono la sicurezza del servizio, la prevenzione di usi impropri, la gestione di contestazioni, il mantenimento di dati coerenti e il miglioramento operativo del flusso di pubblicazione e pagamento.",
            ],
            title: "15. Legittimo interesse",
          },
          {
            id: "consent",
            paragraphs: [
              "Se in futuro verranno introdotti strumenti che richiedono consenso, come analytics o marketing non essenziali, tali strumenti dovranno restare disattivati fino a una scelta valida dell'utente. Alla data di questa bozza non sono stati identificati nel codice strumenti di questo tipo attivi per default.",
            ],
            title: "16. Consenso, quando richiesto",
          },
          {
            id: "recipients",
            bullets: [
              "Stripe per pagamenti, verifiche e payout;",
              "Resend o il provider SMTP configurato per email transazionali;",
              "Twilio o Meta WhatsApp per verifiche via SMS o WhatsApp, se configurati;",
              "OpenStreetMap Nominatim per suggerimenti indirizzo richiesti dall'utente;",
              "fornitori tecnici di hosting, infrastruttura, database, storage locale applicativo e sicurezza, nella misura necessaria al funzionamento del servizio;",
              "professionisti, consulenti o autorita quando necessario per obblighi legali o tutela dei diritti.",
            ],
            title: "17. Destinatari e fornitori di servizi",
          },
          {
            id: "transfers",
            paragraphs: [
              "Alcuni fornitori possono trattare dati al di fuori dello SEE. In tali casi intendiamo fare affidamento su strumenti di trasferimento riconosciuti, come clausole contrattuali standard o altri meccanismi leciti, ove applicabili.",
              "La localizzazione esatta e le garanzie di ciascun fornitore dovranno essere confermate prima del lancio in produzione.",
            ],
            title: "18. Trasferimenti internazionali",
          },
          {
            id: "retention",
            paragraphs: [
              `Conserviamo i dati per il tempo necessario alle finalita sopra descritte, per l'adempimento di obblighi legali, per la gestione di contestazioni e per esigenze di sicurezza. I periodi precisi devono essere completati prima del lancio: ${LEGAL_PLACEHOLDERS.dataRetentionPeriod}.`,
            ],
            title: "19. Periodi di conservazione",
          },
          {
            id: "security",
            paragraphs: [
              "Applichiamo misure tecniche e organizzative ragionevoli per proteggere i dati personali, inclusi controlli di accesso, hashing delle password, validazioni lato server e limitazioni operative nei flussi sensibili. Nessun sistema puo garantire sicurezza assoluta.",
            ],
            title: "20. Misure di sicurezza",
          },
          {
            id: "rights",
            paragraphs: [
              "Nei limiti previsti dal GDPR, puoi chiedere accesso, rettifica, cancellazione, limitazione del trattamento, opposizione e portabilita dei dati. Puoi anche ritirare un consenso eventualmente prestato, senza pregiudicare la liceita del trattamento precedente al ritiro.",
              "Hai inoltre il diritto di presentare reclamo al Garante per la protezione dei dati personali: https://www.garanteprivacy.it/.",
            ],
            title: "21. Diritti degli interessati e reclamo al Garante",
          },
          {
            id: "mandatory",
            paragraphs: [
              "Il conferimento di alcuni dati e necessario per creare account, verificare schede, completare pagamenti o ricevere payout. Altri dati possono essere facoltativi e verranno indicati come tali nei moduli.",
            ],
            title: "22. Dati obbligatori o facoltativi",
          },
          {
            id: "automated",
            paragraphs: [
              "Sulla base del codice esaminato, non risultano decisioni automatizzate con effetti giuridici o analogamente significativi nei confronti degli utenti. Restano possibili controlli tecnici, di verifica e antifrode limitati alla gestione operativa del servizio.",
            ],
            title: "23. Profilazione o decisioni automatizzate",
          },
          {
            id: "children",
            paragraphs: [
              "I servizi business e Partner sono destinati ad adulti. Se ritieni che un minore ci abbia fornito dati personali in modo improprio, contattaci per la valutazione del caso.",
            ],
            title: "24. Minori",
          },
          {
            id: "changes",
            paragraphs: [
              "Possiamo aggiornare questa Informativa per riflettere cambi normativi, tecnici o organizzativi. La data di ultimo aggiornamento e la versione pubblicata in questa pagina permettono di identificare il testo vigente.",
            ],
            title: "25. Modifiche all'Informativa sulla Privacy",
          },
          {
            id: "privacy-contact",
            paragraphs: [
              `Contatti privacy: ${LEGAL_PLACEHOLDERS.privacyContactEmail}.`,
            ],
            title: "26. Contatto privacy",
          },
        ]
      : [
          {
            id: "controller",
            paragraphs: [
              `${LEGAL_PLACEHOLDERS.legalBusinessName}, with registered address at ${LEGAL_PLACEHOLDERS.registeredAddress} and VAT no. ${LEGAL_PLACEHOLDERS.partitaIva}, acts as the data controller for personal data processed through Salento Local.`,
              `For privacy requests, contact ${LEGAL_PLACEHOLDERS.privacyContactEmail}. For commercial or account matters, contact ${LEGAL_PLACEHOLDERS.businessContactEmail}.`,
            ],
            title: "1. Identity and contact details of the data controller",
          },
          {
            id: "categories",
            bullets: [
              "account and authentication data, such as email, username, hashed password, account role, and email-verification status;",
              "Local Partner data, such as phone, WhatsApp, hometown or coverage area, birth date, preferred language, payout information, and Stripe Connect status;",
              "business-owner data, such as name, role, private email, private phone, listing data, and authorization signature;",
              "listing content, uploaded photos, descriptions, opening hours, addresses, social links, and public or private contact information;",
              "payment and payout data, including amounts, statuses, Stripe references, Partner commissions, and related payout details;",
              "verification data, such as one-time codes, delivery channels, timestamps, attempts, and verification status;",
              "transactional communications, such as verification emails, receipts, operational support messages, and payout notices;",
              "minimum technical data needed for sessions, login, language selection, and application security.",
            ],
            title: "2. Categories of personal data collected",
          },
          {
            id: "partner-data",
            paragraphs: [
              "When a Local Partner creates or completes an account, we may process information needed for onboarding, operational profile setup, Stripe Connect configuration, and commission management.",
            ],
            title: "3. Information supplied by Local Partners",
          },
          {
            id: "business-owner-data",
            paragraphs: [
              "When a business owner creates an account, claims a listing, or publishes a business, we process the information needed to verify ownership, manage the listing, process payment, and provide operational support.",
            ],
            title: "4. Information supplied by business owners",
          },
          {
            id: "auth",
            paragraphs: [
              "Salento Local uses email-or-username and password authentication. Passwords are stored only as hashes and not in plain text.",
            ],
            title: "5. Account and authentication data",
          },
          {
            id: "listing-content",
            paragraphs: [
              "Listing flows can include descriptive content, contact details, uploaded images, addresses, opening hours, and private owner or manager details used for verification and internal follow-up.",
            ],
            title: "6. Business listing and uploaded-content data",
          },
          {
            id: "payments",
            paragraphs: [
              "Listing payments and Partner payouts may be handled through Stripe. Stripe may process payment details, tax data, identity checks, payout-account information, and transaction metadata under Stripe's own documentation and privacy terms.",
            ],
            title: "7. Payment and payout processing through Stripe",
          },
          {
            id: "communications",
            paragraphs: [
              "We may send verification emails, receipts, and other transactional messages through Resend or through the SMTP provider configured in the environment.",
              "SMS or WhatsApp verification can be handled through Twilio Verify, Twilio SMS, or Meta WhatsApp Cloud API where configured.",
            ],
            title: "8. Communications, verification emails, and receipts",
          },
          {
            id: "technical",
            paragraphs: [
              "The reviewed code uses authentication/session cookies, a language-preference cookie, and other minimum technical data necessary to run the service. We did not identify active non-essential analytics, advertising, or profiling tools in the code reviewed for this draft.",
              "The reviewed application database does not show a clear, systematic application-level store of IP addresses or user-agent strings; however, hosting or network infrastructure may generate transient logs outside the application and those arrangements should be verified before production launch.",
            ],
            title: "9. Technical, security, log, device, and usage data",
          },
          {
            id: "cookies",
            paragraphs: [
              "Please see the Cookie Policy for details about cookies and similar technologies used on the website.",
            ],
            title: "10. Cookies and similar technologies",
          },
          {
            id: "purposes",
            bullets: [
              "to create and manage user accounts;",
              "to publish, verify, edit, and administer business listings;",
              "to process payments, receipts, commissions, and payouts;",
              "to carry out ownership verification and prevent misuse or fraud;",
              "to respond to operational and support requests;",
              "to maintain the security, integrity, and technical continuity of the service.",
            ],
            title: "11. Purposes of processing",
          },
          {
            id: "legal-bases",
            paragraphs: [
              "We primarily process personal data to perform a contract or requested pre-contractual steps, to comply with legal obligations, to pursue legitimate interests connected with security and platform management, and, where needed, on the basis of consent.",
            ],
            title: "12. Legal bases relied upon under GDPR",
          },
          {
            id: "contractual-necessity",
            paragraphs: [
              "Many fields requested in account, claim, publishing, payment, and payout flows are necessary to provide the requested service. If you do not provide them, we may be unable to create or maintain the relevant service.",
            ],
            title: "13. Contractual necessity",
          },
          {
            id: "legal-obligations",
            paragraphs: [
              "Some data may be processed to meet accounting, tax, anti-fraud, security, authority-response, or other legal obligations.",
            ],
            title: "14. Legal obligations",
          },
          {
            id: "legitimate-interests",
            paragraphs: [
              "Our legitimate interests include service security, prevention of misuse, dispute management, keeping data coherent, and improving the operational flow for publishing and payments.",
            ],
            title: "15. Legitimate interests",
          },
          {
            id: "consent",
            paragraphs: [
              "If the platform later introduces tools that require consent, such as non-essential analytics or marketing technologies, those tools should remain disabled until valid consent is recorded. At the date of this draft, we did not identify such tools as active by default in the code reviewed.",
            ],
            title: "16. Consent where consent is actually required",
          },
          {
            id: "recipients",
            bullets: [
              "Stripe for payments, verification, and payouts;",
              "Resend or the configured SMTP provider for transactional emails;",
              "Twilio or Meta WhatsApp for SMS or WhatsApp verification where configured;",
              "OpenStreetMap Nominatim for user-requested address suggestions;",
              "technical hosting, infrastructure, database, local application storage, and security providers to the extent needed to run the service;",
              "professional advisers or public authorities where required by law or needed to protect rights.",
            ],
            title: "17. Data recipients and service providers",
          },
          {
            id: "transfers",
            paragraphs: [
              "Some service providers may process personal data outside the EEA. In those cases, we intend to rely on recognized transfer mechanisms such as standard contractual clauses or other lawful safeguards where applicable.",
              "The exact provider locations and safeguards should be confirmed before production launch.",
            ],
            title: "18. International data transfers and safeguards",
          },
          {
            id: "retention",
            paragraphs: [
              `We keep personal data for as long as needed for the purposes described above, for legal compliance, dispute management, and security needs. Precise retention periods still need to be completed before production launch: ${LEGAL_PLACEHOLDERS.dataRetentionPeriod}.`,
            ],
            title: "19. Retention periods or retention criteria",
          },
          {
            id: "security",
            paragraphs: [
              "We apply reasonable technical and organizational safeguards, including access controls, password hashing, server-side validation, and operational restrictions in sensitive flows. No system can guarantee absolute security.",
            ],
            title: "20. Data-security measures",
          },
          {
            id: "rights",
            paragraphs: [
              "Subject to GDPR and applicable law, you may request access, correction, deletion, restriction, objection, and portability where applicable. You may also withdraw consent where processing relies on consent, without affecting prior lawful processing.",
              "You also have the right to lodge a complaint with the Italian Data Protection Authority: https://www.garanteprivacy.it/.",
            ],
            title: "21. GDPR rights and complaints",
          },
          {
            id: "mandatory",
            paragraphs: [
              "Some information is required to create accounts, verify listings, complete payments, or receive payouts. Other information may be optional and will be identified as such in the relevant forms.",
            ],
            title: "22. Whether data is contractual or optional",
          },
          {
            id: "automated",
            paragraphs: [
              "Based on the reviewed code, we did not identify automated decision-making with legal or similarly significant effects on users. Limited technical, verification, and anti-fraud checks may still be used for routine operational management.",
            ],
            title: "23. Automated decision-making or profiling",
          },
          {
            id: "children",
            paragraphs: [
              "Business and Partner services are intended for adults. If you believe a child has improperly provided personal data to us, please contact us so we can review the situation.",
            ],
            title: "24. Children and minimum age",
          },
          {
            id: "changes",
            paragraphs: [
              "We may update this Privacy Policy to reflect legal, technical, or organizational changes. The last-updated date and version shown on this page help identify the current text.",
            ],
            title: "25. Changes to the Privacy Policy",
          },
          {
            id: "privacy-contact",
            paragraphs: [
              `Privacy contact: ${LEGAL_PLACEHOLDERS.privacyContactEmail}.`,
            ],
            title: "26. Privacy contact details",
          },
        ];

  return {
    sections,
    summary:
      locale === "it"
        ? "Questa bozza spiega come Salento Local tratta i dati personali di utenti, attivita commerciali e Partner locali sulla base del codice attualmente presente nel progetto."
        : "This draft explains how Salento Local processes personal data of users, businesses, and Local Partners based on the code currently present in the project.",
    title:
      locale === "it" ? "Informativa sulla Privacy" : "Privacy Policy",
    version: LEGAL_DOCUMENTS.privacyPolicy.version,
  };
}

export function getCookieTable(locale: Locale): CookieTableRow[] {
  if (locale === "it") {
    return [
      {
        category: "Necessari",
        consentRequired: "No",
        duration: "Sessione o fino a 30 giorni a seconda del cookie Auth.js e del contesto; verificare in produzione",
        name: "[AUTH SESSION COOKIE NAME - VERIFY IN PRODUCTION]",
        provider: "Salento Local / Auth.js",
        purpose:
          "Mantiene la sessione di accesso e riconosce l'utente autenticato nelle aree account.",
      },
      {
        category: "Necessari",
        consentRequired: "No",
        duration: "Breve durata o sessione; verificare in produzione",
        name: "[AUTH CSRF COOKIE NAME - VERIFY IN PRODUCTION]",
        provider: "Salento Local / Auth.js",
        purpose:
          "Protegge i moduli di autenticazione e altre richieste sensibili da tentativi di falsificazione.",
      },
      {
        category: "Necessari",
        consentRequired: "No",
        duration: "Breve durata; verificare in produzione",
        name: "[AUTH CALLBACK COOKIE NAME - VERIFY IN PRODUCTION]",
        provider: "Salento Local / Auth.js",
        purpose:
          "Ricorda il percorso di reindirizzamento sicuro durante alcuni flussi di login.",
      },
      {
        category: "Preferenze",
        consentRequired: "No, se usato solo per ricordare la lingua richiesta dall'utente",
        duration: "1 anno",
        name: "salento_locale",
        provider: "Salento Local",
        purpose: "Memorizza la lingua selezionata dall'utente tra italiano e inglese.",
      },
    ];
  }

  return [
    {
      category: "Necessary",
      consentRequired: "No",
      duration: "Session or up to 30 days depending on the Auth.js cookie and environment; verify in production",
      name: "[AUTH SESSION COOKIE NAME - VERIFY IN PRODUCTION]",
      provider: "Salento Local / Auth.js",
      purpose:
        "Keeps the user signed in and recognizes the authenticated account in protected areas.",
    },
    {
      category: "Necessary",
      consentRequired: "No",
      duration: "Short-lived or session-based; verify in production",
      name: "[AUTH CSRF COOKIE NAME - VERIFY IN PRODUCTION]",
      provider: "Salento Local / Auth.js",
      purpose:
        "Protects authentication and other sensitive form submissions against forgery attempts.",
    },
    {
      category: "Necessary",
      consentRequired: "No",
      duration: "Short-lived; verify in production",
      name: "[AUTH CALLBACK COOKIE NAME - VERIFY IN PRODUCTION]",
      provider: "Salento Local / Auth.js",
      purpose:
        "Stores a safe callback path during some sign-in and redirect flows.",
    },
    {
      category: "Preferences",
      consentRequired: "No, if used only to remember the language requested by the user",
      duration: "1 year",
      name: "salento_locale",
      provider: "Salento Local",
      purpose: "Remembers the user's selected language between Italian and English.",
    },
  ];
}

export function getCookieDocument(locale: Locale) {
  const sections: LegalSection[] =
    locale === "it"
      ? [
          {
            id: "what-are-cookies",
            paragraphs: [
              "I cookie sono piccoli file di testo o tecnologie simili che permettono al sito di funzionare, ricordare preferenze e gestire alcune funzioni tecniche.",
            ],
            title: "1. Cosa sono cookie e tecnologie simili",
          },
          {
            id: "controller",
            paragraphs: [
              `${LEGAL_PLACEHOLDERS.legalBusinessName} controlla il sito Salento Local. Per i dati di contatto principali consulta anche l'Informativa sulla Privacy e i Termini e Condizioni.`,
            ],
            title: "2. Chi controlla il sito",
          },
          {
            id: "necessary",
            paragraphs: [
              "Dal codice esaminato risultano cookie necessari per autenticazione, sessione e sicurezza, oltre a un cookie di preferenza lingua. Questi strumenti sono usati per far funzionare correttamente login, aree riservate e scelta della lingua.",
            ],
            title: "3. Cookie strettamente necessari",
          },
          {
            id: "preferences",
            paragraphs: [
              "Il sito usa un cookie per ricordare la lingua selezionata dall'utente. Questo aiuta a mantenere coerente l'esperienza tra versione italiana e inglese.",
            ],
            title: "4. Cookie di preferenza e lingua",
          },
          {
            id: "analytics",
            paragraphs: [
              "Nel codice esaminato per questa bozza non sono stati individuati strumenti di analytics non essenziali caricati di default. Se in futuro verranno introdotti, dovranno essere bloccati fino a consenso valido, salvo i casi in cui la legge consenta diversamente.",
            ],
            title: "5. Cookie analytics",
          },
          {
            id: "marketing",
            paragraphs: [
              "Nel codice esaminato non sono stati individuati pixel pubblicitari o cookie di profilazione attivi di default.",
            ],
            title: "6. Cookie pubblicitari o di profilazione",
          },
          {
            id: "third-party",
            paragraphs: [
              "Salento Local reindirizza alcuni utenti verso pagine ospitate da Stripe per checkout, bonifici guidati o onboarding Stripe Connect. Eventuali cookie impostati su domini Stripe sono gestiti da Stripe secondo la propria informativa.",
              "Il sito puo anche effettuare richieste lato server verso OpenStreetMap Nominatim per suggerimenti indirizzo richiesti dall'utente, ma questo non equivale di per se a un cookie client non essenziale di analytics o marketing sul sito.",
            ],
            title: "7. Cookie e tecnologie di terze parti",
          },
          {
            id: "table",
            paragraphs: [
              "La tabella seguente riassume i cookie o identificatori tecnici individuati o ragionevolmente attesi sulla base del codice applicativo esaminato.",
            ],
            title: "8. Tabella dei cookie",
          },
          {
            id: "consent",
            paragraphs: [
              "Poiche in questa revisione non sono stati trovati strumenti non essenziali attivi di default, non e stato aggiunto un banner ingannevole di tipo 'Accetta tutto'. Se in futuro verranno introdotti strumenti analytics, marketing o profilazione non essenziali, il sito dovra raccogliere una scelta valida prima del loro caricamento.",
            ],
            title: "9. Consenso e gestione preferenze",
          },
          {
            id: "browser",
            paragraphs: [
              "Puoi anche gestire i cookie tramite le impostazioni del browser. Disabilitare cookie necessari puo compromettere login, sessione, lingua selezionata o altre funzioni essenziali del sito.",
            ],
            title: "10. Gestione tramite browser",
          },
          {
            id: "changes",
            paragraphs: [
              "Possiamo aggiornare questa Cookie Policy se il sito cambia i cookie o le tecnologie impiegate.",
            ],
            title: "11. Modifiche alla Cookie Policy",
          },
          {
            id: "contact",
            paragraphs: [
              `Per domande su cookie o privacy puoi contattarci a ${LEGAL_PLACEHOLDERS.privacyContactEmail}.`,
            ],
            title: "12. Contatti",
          },
        ]
      : [
          {
            id: "what-are-cookies",
            paragraphs: [
              "Cookies are small text files or similar technologies that help the website function, remember preferences, and support technical features.",
            ],
            title: "1. What cookies and similar technologies are",
          },
          {
            id: "controller",
            paragraphs: [
              `${LEGAL_PLACEHOLDERS.legalBusinessName} controls the Salento Local website. Please also see the Privacy Policy and Terms & Conditions for primary contact details.`,
            ],
            title: "2. Who controls the website",
          },
          {
            id: "necessary",
            paragraphs: [
              "The reviewed code shows necessary cookies for authentication, session handling, and security, plus a language-preference cookie. These technologies help login, protected account areas, and language selection work properly.",
            ],
            title: "3. Strictly necessary cookies",
          },
          {
            id: "preferences",
            paragraphs: [
              "The site uses a cookie to remember the language selected by the user. This keeps the experience consistent between Italian and English.",
            ],
            title: "4. Preference and language cookies",
          },
          {
            id: "analytics",
            paragraphs: [
              "We did not identify non-essential analytics tools loading by default in the reviewed code for this draft. If such tools are introduced later, they should remain blocked until valid consent is obtained unless the law clearly allows otherwise.",
            ],
            title: "5. Analytics cookies",
          },
          {
            id: "marketing",
            paragraphs: [
              "We did not identify advertising pixels or profiling cookies active by default in the reviewed code.",
            ],
            title: "6. Advertising or profiling cookies",
          },
          {
            id: "third-party",
            paragraphs: [
              "Salento Local redirects some users to Stripe-hosted pages for checkout, bank-transfer instructions, or Stripe Connect onboarding. Any cookies placed on Stripe domains are controlled by Stripe under Stripe's own policies.",
              "The website may also make server-side requests to OpenStreetMap Nominatim for user-requested address suggestions, but that does not by itself amount to a non-essential client-side analytics or marketing cookie on this website.",
            ],
            title: "7. Third-party cookies and technologies",
          },
          {
            id: "table",
            paragraphs: [
              "The following table summarizes the cookies or technical identifiers identified or reasonably expected from the reviewed application code.",
            ],
            title: "8. Cookie table",
          },
          {
            id: "consent",
            paragraphs: [
              "Because this review did not identify default-loaded non-essential tracking tools, we have not added a misleading 'Accept all' banner. If non-essential analytics, marketing, or profiling technologies are added in the future, the site should collect a valid choice before they load.",
            ],
            title: "9. Consent and preference management",
          },
          {
            id: "browser",
            paragraphs: [
              "You can also manage cookies through your browser settings. Disabling necessary cookies may affect login, session handling, language selection, or other essential website functions.",
            ],
            title: "10. Browser controls",
          },
          {
            id: "changes",
            paragraphs: [
              "We may update this Cookie Policy if the website changes the cookies or related technologies it uses.",
            ],
            title: "11. Changes to the Cookie Policy",
          },
          {
            id: "contact",
            paragraphs: [
              `For cookie or privacy questions, contact ${LEGAL_PLACEHOLDERS.privacyContactEmail}.`,
            ],
            title: "12. Contact details",
          },
        ];

  return {
    cookieTable: getCookieTable(locale),
    sections,
    summary:
      locale === "it"
        ? "Questa bozza descrive i cookie e gli identificatori tecnici individuati nel codice del progetto al momento della revisione."
        : "This draft describes the cookies and technical identifiers identified in the project code at the time of review.",
    title: "Cookie Policy",
    version: LEGAL_DOCUMENTS.cookiePolicy.version,
  };
}
