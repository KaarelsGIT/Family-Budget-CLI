import { CommonModule } from '@angular/common';
import { Component, HostListener, computed, effect, inject, input, output, signal } from '@angular/core';
import { TranslationService } from '../../../core/services/i18n/translation.service';

type HelpLanguage = 'et' | 'en' | 'fi';

interface HelpSection {
  id: string;
  title: string;
  intro: string;
  points: string[];
}

interface HelpContent {
  eyebrow: string;
  title: string;
  subtitle: string;
  tocTitle: string;
  backToTop: string;
  closeLabel: string;
  sections: HelpSection[];
}

const helpContent: Record<HelpLanguage, HelpContent> = {
  et: {
    eyebrow: 'Abi',
    title: 'Kasutusjuhend',
    subtitle: 'Siin on rakenduse töövood lühidalt lahti kirjutatud: kontod, tehingud, statistika, korduvad maksed ja teavitused.',
    tocTitle: 'Sisukord',
    backToTop: 'Tagasi üles',
    closeLabel: 'Sulge',
    sections: [
      {
        id: 'navigation',
        title: 'Päis ja liikumine',
        intro: 'Ülemine päis viib sind põhivaadete ja tööriistadeni ilma lehte ümber laadimata.',
        points: [
          'Kontod, tehingud ja statistika on pidevalt ülemises menüüs nähtavad.',
          'Tehingute menüüst avad tehingute vaate, korduvad maksed ja kategooriate halduse.',
          'Tööriistade alt leiad kalkulaatori ja palgakalkulaatori.',
          'Teavituste ikoon näitab uusi sündmusi ning vajadusel viib sind otse vastava tegevuseni.',
          'Keelevalik muudab kogu rakenduse teksti, sh selle juhendi.'
        ]
      },
      {
        id: 'accounts',
        title: 'Kontod',
        intro: 'Kontode vaates näed oma põhikontot ja muid kontosid, millele sul on ligipääs.',
        points: [
          'Konto kaardilt saad nime muuta, saldot korrigeerida, kontot jagada või ülekannet teha.',
          'Omanik saab jagamise hiljem lõpetada või konto kustutamist taotleda.',
          'Jagatud kontol võib sul olla toimetaja või vaataja roll.',
          'Konto tüüp näitab, kas tegemist on põhikonto, säästukonto, alamkonto või sularahakontoga.',
          'Kui konto kõrval on jagamise märk, tähendab see, et teised kasutajad näevad seda kontot oma vaates.'
        ]
      },
      {
        id: 'transactions',
        title: 'Tehingud',
        intro: 'Tehingu lisamisel vali kõigepealt tüüp ja seejärel õige konto ning kategooria.',
        points: [
          'Tulu ja kulu saab lisada ainult kontole, millel sul on OWNER või EDITOR õigus.',
          'Ülekande puhul valid lähtekonto ja sihtkonto; sihtkonto puhul läheb raha selle kasutaja põhikontole.',
          'Tehingut saab muuta või kustutada ainult selle looja.',
          'Kui kontol ei ole piisavalt raha, kuvatakse vea teade enne tehingu salvestamist.'
        ]
      },
      {
        id: 'categories',
        title: 'Kategooriad ja korduvad maksed',
        intro: 'Kategooriad määravad, kuidas tehingud jaotuvad, ning korduvad maksed hoiavad regulaarseid kulusid ja tulusid kontrolli all.',
        points: [
          'Kategooriaid haldad eraldi kategooriate vaates tehingute menüüst.',
          'Saad luua peakategooriaid ja alamkategooriaid nii tulu kui kulu jaoks.',
          'Korduva makse vaates saad lisada regulaarselt korduva tehingu ning määrata summa, kategooria ja maksepäeva.',
          'Meeldetuletusi saab hiljem kas maksta või vahele jätta ning nende staatus arvutatakse muutuste järgi ümber.'
        ]
      },
      {
        id: 'statistics',
        title: 'Statistika',
        intro: 'Statistika näitab aasta lõikes tulusid, kulusid, netot, sääste ja kategooriate jaotust.',
        points: [
          'Filtritega saad valida aasta, kuu, kasutaja ja konto.',
          'Kuuvaade aitab võrrelda tulusid, kulusid ja netot kuude lõikes.',
          'Säästude vaade näitab, kuidas saldo ajas muutub.',
          'Kategooriate vaade kuvab jaotuse graafikuna ning tabelina.'
        ]
      },
      {
        id: 'notifications',
        title: 'Teavitused ja tööriistad',
        intro: 'Teavitused koondavad olulised sündmused ning tööriistad aitavad kiiresti kontrollida summasid.',
        points: [
          'Teavituste paneelis näed uusi sündmusi, näiteks jagamisi, ülekandeid ja korduvaid makseid.',
          'Mõnede teavituste juures saad minna otse makse või meeldetuletuse juurde.',
          'Kalkulaator sobib kiireks summade kontrolliks.',
          'Palgakalkulaator näitab brutopalgast netopalka ja mahaarvamisi.'
        ]
      }
    ]
  },
  en: {
    eyebrow: 'Help',
    title: 'User guide',
    subtitle: 'A short guide to the actual workflows in the app: accounts, transactions, statistics, recurring payments, and notifications.',
    tocTitle: 'Contents',
    backToTop: 'Back to top',
    closeLabel: 'Close',
    sections: [
      {
        id: 'navigation',
        title: 'Header and navigation',
        intro: 'The top header takes you to the main views and tools without reloading the page.',
        points: [
          'Accounts, transactions, and statistics are always visible in the header.',
          'The transactions menu opens the transactions page, recurring payments, and category management.',
          'The tools menu contains the calculator and the salary calculator.',
          'The notifications icon shows new events and can take you directly to the related action.',
          'Changing the language updates the whole app, including this guide.'
        ]
      },
      {
        id: 'accounts',
        title: 'Accounts',
        intro: 'The accounts view shows your default main account and any other accounts you can access.',
        points: [
          'From an account card you can rename the account, adjust the balance, share it, or create a transfer.',
          'The owner can later remove sharing or request deletion.',
          'A shared account can give you editor or viewer access.',
          'The account type tells you whether it is a main, savings, sub-account, or cash account.',
          'A shared badge means the account is visible to other users too.'
        ]
      },
      {
        id: 'transactions',
        title: 'Transactions',
        intro: 'When adding a transaction, choose the type first and then the correct account and category.',
        points: [
          'Income and expense are allowed only for accounts where you have OWNER or EDITOR rights.',
          'Transfers use a source account and a destination account; the destination user always receives the money on their default main account.',
          'A transaction can be edited or deleted only by its creator.',
          'If an account does not have enough money, the app shows an error before saving.'
        ]
      },
      {
        id: 'categories',
        title: 'Categories and recurring payments',
        intro: 'Categories define how transactions are grouped, and recurring payments keep regular income and costs in view.',
        points: [
          'You manage categories from the category page in the transactions menu.',
          'You can create main categories and subcategories for both income and expense.',
          'Recurring payments let you define a repeating transaction with amount, category, and due day.',
          'Reminders can later be paid or skipped, and their status is recalculated from the current transactions.'
        ]
      },
      {
        id: 'statistics',
        title: 'Statistics',
        intro: 'Statistics show yearly income, expenses, net, savings, and category distribution.',
        points: [
          'Filters let you choose year, month, user, and account.',
          'The monthly view compares income, expenses, and net by month.',
          'The savings view shows how the balance changes over time.',
          'The category view shows the distribution as both a chart and a table.'
        ]
      },
      {
        id: 'notifications',
        title: 'Notifications and tools',
        intro: 'Notifications collect important events, and the tools help you check amounts quickly.',
        points: [
          'The notifications panel shows new events such as sharing, transfers, and recurring payments.',
          'Some notifications can take you directly to the payment or reminder action.',
          'The calculator is useful for quick checks.',
          'The salary calculator shows net salary and deductions from a gross salary.'
        ]
      }
    ]
  },
  fi: {
    eyebrow: 'Ohje',
    title: 'Käyttöopas',
    subtitle: 'Lyhyt opas sovelluksen oikeisiin työvaiheisiin: tilit, tapahtumat, tilastot, toistuvat maksut ja ilmoitukset.',
    tocTitle: 'Sisällys',
    backToTop: 'Takaisin ylös',
    closeLabel: 'Sulje',
    sections: [
      {
        id: 'navigation',
        title: 'Yläpalkki ja siirtyminen',
        intro: 'Yläpalkki vie pääsivuille ja työkaluihin ilman sivun uudelleenlatausta.',
        points: [
          'Tilit, tapahtumat ja tilastot näkyvät aina yläpalkissa.',
          'Tapahtumat-valikosta avaat tapahtumat, toistuvat maksut ja kategorialuettelon hallinnan.',
          'Työkalut-valikossa on laskin ja palkkalaskin.',
          'Ilmoituskuvake näyttää uudet tapahtumat ja voi ohjata suoraan oikeaan toimintaan.',
          'Kielen vaihtaminen päivittää koko sovelluksen, myös tämän oppaan.'
        ]
      },
      {
        id: 'accounts',
        title: 'Tilit',
        intro: 'Tilinäkymä näyttää oletuspäätilisi ja muut tilit, joihin sinulla on käyttöoikeus.',
        points: [
          'Tilikortista voit nimetä tilin uudelleen, säätää saldoa, jakaa tilin tai tehdä siirron.',
          'Omistaja voi myöhemmin poistaa jaon tai pyytää tilin poistamista.',
          'Jaetulla tilillä voi olla muokkaaja- tai katseluoikeus.',
          'Tilin tyyppi kertoo, onko kyseessä pää-, säästö-, ala- vai käteistili.',
          'Jaon merkki kertoo, että tili näkyy myös muille käyttäjille.'
        ]
      },
      {
        id: 'transactions',
        title: 'Tapahtumat',
        intro: 'Kun lisäät tapahtuman, valitse ensin tyyppi ja sitten oikea tili ja kategoria.',
        points: [
          'Tulo ja meno ovat sallittuja vain tileiltä, joihin sinulla on OWNER- tai EDITOR-oikeus.',
          'Siirroissa valitset lähdetilin ja kohdetilin; kohdekäyttäjä saa rahat aina hänen oletuspäätililleen.',
          'Vain tapahtuman luoja voi muokata tai poistaa sen.',
          'Jos tilillä ei ole tarpeeksi rahaa, sovellus näyttää virheen ennen tallennusta.'
        ]
      },
      {
        id: 'categories',
        title: 'Kategoriat ja toistuvat maksut',
        intro: 'Kategoriat määrittävät, miten tapahtumat ryhmitellään, ja toistuvat maksut pitävät säännölliset menot ja tulot näkyvissä.',
        points: [
          'Kategorioita hallitaan tapahtumien valikon kategoriavälilehdeltä.',
          'Voit luoda sekä pää- että alakategorioita tuloille ja menoille.',
          'Toistuvassa maksussa määrität summan, kategorian ja eräpäivän.',
          'Muistutus voidaan myöhemmin maksaa tai ohittaa, ja sen tila lasketaan uudelleen nykyisten tapahtumien perusteella.'
        ]
      },
      {
        id: 'statistics',
        title: 'Tilastot',
        intro: 'Tilastot näyttävät vuoden tulot, menot, nettotuloksen, säästöt ja kategorioiden jakauman.',
        points: [
          'Suodattimilla valitset vuoden, kuukauden, käyttäjän ja tilin.',
          'Kuukausinäkymä vertaa tuloja, menoja ja nettoa kuukausittain.',
          'Säästönäkymä näyttää, miten saldo muuttuu ajan myötä.',
          'Kategoria-näkymä näyttää jaon sekä kaaviona että taulukkona.'
        ]
      },
      {
        id: 'notifications',
        title: 'Ilmoitukset ja työkalut',
        intro: 'Ilmoitukset kokoavat tärkeät tapahtumat ja työkalut auttavat tarkistamaan summia nopeasti.',
        points: [
          'Ilmoituspaneeli näyttää uudet tapahtumat, kuten jaot, siirrot ja toistuvat maksut.',
          'Osa ilmoituksista vie suoraan maksuun tai muistutukseen.',
          'Laskin sopii nopeaan tarkistukseen.',
          'Palkkalaskin näyttää bruttopalkan netoksi sekä vähennykset.'
        ]
      }
    ]
  }
};

@Component({
  selector: 'app-help-guide-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './help-guide-modal.component.html',
  styleUrl: './help-guide-modal.component.css'
})
export class HelpGuideModalComponent {
  readonly i18n = inject(TranslationService);
  readonly isOpen = input(false);
  readonly closed = output<void>();

  readonly activeSectionId = signal(helpContent.et.sections[0]?.id ?? 'overview');
  readonly modalOffsetX = signal(0);
  readonly modalOffsetY = signal(0);

  readonly content = computed(() => {
    const language = this.i18n.language() as HelpLanguage;
    return helpContent[language] ?? helpContent.et;
  });

  private wasOpen = false;
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOriginX = 0;
  private dragOriginY = 0;

  constructor() {
    effect(() => {
      const open = this.isOpen();
      if (open && !this.wasOpen) {
        this.activeSectionId.set(this.content().sections[0]?.id ?? 'overview');
        this.modalOffsetX.set(0);
        this.modalOffsetY.set(0);
      }
      this.wasOpen = open;
    }, { allowSignalWrites: true });
  }

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (this.isOpen()) {
      this.close();
    }
  }

  close(): void {
    this.closed.emit();
  }

  startDrag(event: PointerEvent): void {
    if (event.button !== 0 || !this.isOpen()) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (!target || target.closest('button, a, input, select, textarea')) {
      return;
    }

    this.dragging = true;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragOriginX = this.modalOffsetX();
    this.dragOriginY = this.modalOffsetY();
    (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
  }

  onDrag(event: PointerEvent): void {
    if (!this.dragging) {
      return;
    }

    this.modalOffsetX.set(this.dragOriginX + (event.clientX - this.dragStartX));
    this.modalOffsetY.set(this.dragOriginY + (event.clientY - this.dragStartY));
  }

  stopDrag(event?: PointerEvent): void {
    if (event?.currentTarget) {
      try {
        (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
      } catch {
        // Ignore pointer capture release errors.
      }
    }

    this.dragging = false;
  }

  scrollToSection(sectionId: string): void {
    this.activeSectionId.set(sectionId);
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  scrollToTop(): void {
    const content = document.querySelector('.help-guide-modal .guide-content');
    if (content instanceof HTMLElement) {
      content.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  getModalTransform(): string {
    return `translate3d(${this.modalOffsetX()}px, ${this.modalOffsetY()}px, 0)`;
  }
}
