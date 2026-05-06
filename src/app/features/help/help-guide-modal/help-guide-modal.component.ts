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
    subtitle: 'Kiire ülevaade sellest, kuidas rakendus töötab ja kust vajalikud vaated leiad.',
    tocTitle: 'Sisukord',
    backToTop: 'Tagasi üles',
    closeLabel: 'Sulge',
    sections: [
      {
        id: 'overview',
        title: 'Alustuseks',
        intro: 'Rakendus koondab pere rahaasjad ühte kohta ning hoiab ligipääsu rollipõhiselt korras.',
        points: [
          'Kasuta ülemist menüüd, et liikuda kontode, tehingute ja statistika vahel.',
          'Teavituste ikoon näitab olulisi sündmusi ja juhib sind otse vastava tegevuseni.',
          'Keele valik muudab kogu äpi teksti, sealhulgas selle juhendi.'
        ]
      },
      {
        id: 'navigation',
        title: 'Liikumine',
        intro: 'Päise nupud avavad kõik põhivaated ja tööriistad ilma lehte ümber laadimata.',
        points: [
          'Kontod, tehingud ja statistika on alati ühe klõpsu kaugusel.',
          'Tööriistade menüüst leiad kalkulaatori, kui tahad midagi kiiresti kontrollida.',
          'Abiikoon avab selle juhendi ja sulgub samal viisil nagu teised modaalid.'
        ]
      },
      {
        id: 'accounts',
        title: 'Kontod',
        intro: 'Kontode vaates näed ainult neid kontosid, millele sul on päriselt ligipääs.',
        points: [
          'Omanik saab kontot muuta, jagada ja vajadusel jagamise lõpetada.',
          'Jagatud kontol võib sul olla toimetaja või vaatleja roll.',
          'Konto kaardil saad nime muuta, tasakaalu korrigeerida ja vajadusel konto kustutada või kustutamist taotleda.'
        ]
      },
      {
        id: 'transactions',
        title: 'Tehingud',
        intro: 'Tehingu lisamisel vali kõigepealt tüüp ning seejärel sobiv konto ja kategooria.',
        points: [
          'Tulu ja kulu saab teha ainult kontol, millel sul on OWNER või EDITOR õigus.',
          'Ülekande puhul valid oma konto ja sihtkonto; sihtkonto liigub alati selle kasutaja põhikontole.',
          'Tehinguid saab muuta või kustutada ainult nende looja, ülekanded jäävad muutmata.'
        ]
      },
      {
        id: 'sharing',
        title: 'Jagamine',
        intro: 'Jagatud konto annab teisele kasutajale ligipääsu ilma omandit üle andmata.',
        points: [
          'Kontot saab jagada toimetaja või vaataja õigusega.',
          'Kui keegi teeb jagatud kontolt tehingu, saab omanik selle kohta teavituse.',
          'Jagamise saab samast kontovaatest igal ajal lõpetada.'
        ]
      },
      {
        id: 'statistics',
        title: 'Statistika',
        intro: 'Aastavaade aitab kiiresti näha tulu, kulu, sääste ja kategooriate jaotust.',
        points: [
          'Vali aasta ja konto, et kitsendada vaade just sulle olulistele andmetele.',
          'Kategooriate tabel näitab kuiseid väärtusi ning aasta kokkuvõtet paremal servas.',
          'Diagrammid annavad kiire pildi trendidest ja suurematest muutustest.'
        ]
      },
      {
        id: 'recurring',
        title: 'Korduvad maksed ja teavitused',
        intro: 'Korduvad maksed aitavad regulaarsed kulud või tulud õigel ajal meeles hoida.',
        points: [
          'Lisa korduv makse või märgi kategooria korduvaks ning määra tasumise päev ja summa.',
          'Meeldetuletuse saab maksta või vahele jätta ning staatus arvutatakse jooksvalt ümber.',
          'Teavitused katavad jagamise, ülekanded, korduvad maksed ja muud olulised sündmused.'
        ]
      }
    ]
  },
  en: {
    eyebrow: 'Help',
    title: 'User guide',
    subtitle: 'A quick guide to how the app works and where to find the main views.',
    tocTitle: 'Contents',
    backToTop: 'Back to top',
    closeLabel: 'Close',
    sections: [
      {
        id: 'overview',
        title: 'Getting started',
        intro: 'The app keeps family finances in one place and applies access rules automatically.',
        points: [
          'Use the top navigation to move between accounts, transactions, and statistics.',
          'The notifications icon shows important events and takes you straight to the relevant action.',
          'Changing the language updates the entire app, including this guide.'
        ]
      },
      {
        id: 'navigation',
        title: 'Navigation',
        intro: 'The header gives you access to the main views and tools without reloading the page.',
        points: [
          'Accounts, transactions, and statistics are always one click away.',
          'The tools menu contains the calculator-modal for quick checks.',
          'The help icon opens this guide and closes like the other help.'
        ]
      },
      {
        id: 'accounts',
        title: 'Accounts',
        intro: 'The accounts view only shows accounts that are actually accessible to you.',
        points: [
          'The owner can edit, share, and later remove access.',
          'A shared account can give you either editor or viewer access.',
          'From the account card you can rename, adjust balance, delete, or request deletion.'
        ]
      },
      {
        id: 'transactions',
        title: 'Transactions',
        intro: 'When adding a transaction, choose the type first and then the correct account and category.',
        points: [
          'Income and expense are allowed only for accounts where you have OWNER or EDITOR rights.',
          'Transfers use your own source account and a valid target account; the recipient always lands on their default main account.',
          'Transfers can be edited or deleted when you have access to the source account or you created the transaction.'
        ]
      },
      {
        id: 'sharing',
        title: 'Sharing',
        intro: 'A shared account gives another user access without changing ownership.',
        points: [
          'You can share an account with editor or viewer access.',
          'If someone makes a transaction on a shared account, every other user with access gets a notification.',
          'Sharing can be removed any time from the same account view.'
        ]
      },
      {
        id: 'statistics',
        title: 'Statistics',
        intro: 'The yearly dashboard helps you compare income, expenses, savings, and category distribution.',
        points: [
          'Choose a year and an account to narrow the view to the data you care about.',
          'The category table shows monthly values and the yearly total on the right.',
          'Charts give a quick picture of trends and larger changes.'
        ]
      },
      {
        id: 'recurring',
        title: 'Recurring payments and notifications',
        intro: 'Recurring payments help you keep regular income and costs on track.',
        points: [
          'Add a recurring payment or mark a category as recurring, then define the due day and amount.',
          'A reminder can be paid or skipped, and its status is recalculated as transactions change.',
          'Notifications cover sharing, transfers, recurring payments, and other important events.'
        ]
      }
    ]
  },
  fi: {
    eyebrow: 'Ohje',
    title: 'Käyttöopas',
    subtitle: 'Nopea opas siitä, miten sovellus toimii ja mistä löydät tärkeimmät näkymät.',
    tocTitle: 'Sisällys',
    backToTop: 'Takaisin ylös',
    closeLabel: 'Sulje',
    sections: [
      {
        id: 'overview',
        title: 'Aloitus',
        intro: 'Sovellus kokoaa perheen raha-asiat yhteen paikkaan ja soveltaa käyttöoikeuksia automaattisesti.',
        points: [
          'Käytä ylävalikkoa siirtyäksesi tilien, tapahtumien ja tilastojen välillä.',
          'Ilmoituskuvake näyttää tärkeät tapahtumat ja vie sinut suoraan oikeaan toimintaan.',
          'Kielen vaihtaminen päivittää koko sovelluksen, myös tämän oppaan.'
        ]
      },
      {
        id: 'navigation',
        title: 'Navigointi',
        intro: 'Yläpalkki antaa pääsyn tärkeimpiin näkymiin ja työkaluihin ilman sivun uudelleenlatausta.',
        points: [
          'Tilit, tapahtumat ja tilastot ovat aina yhden klikkauksen päässä.',
          'Työkalut-valikossa on laskin nopeita tarkistuksia varten.',
          'Ohjekuvake avaa tämän oppaan ja sulkeutuu kuten muutkin modaalit.'
        ]
      },
      {
        id: 'accounts',
        title: 'Tilit',
        intro: 'Tilinäkymä näyttää vain ne tilit, joihin sinulla on oikeasti pääsy.',
        points: [
          'Omistaja voi muokata, jakaa ja myöhemmin poistaa käyttöoikeuden.',
          'Jaetulla tilillä voi olla muokkaaja- tai katseluoikeus.',
          'Tilikortista voit nimetä uudelleen, säätää saldoa, poistaa tai pyytää poistamista.'
        ]
      },
      {
        id: 'transactions',
        title: 'Tapahtumat',
        intro: 'Kun lisäät tapahtuman, valitse ensin tyyppi ja sitten oikea tili ja kategoria.',
        points: [
          'Tulo ja meno ovat sallittuja vain tileiltä, joihin sinulla on OWNER- tai EDITOR-oikeus.',
          'Siirroissa valitset oman lähdetilin ja kelvollisen kohdetilin; vastaanottaja menee aina hänen oletus päätililleen.',
          'Vain luoja voi muokata tai poistaa tapahtuman, ja siirrot pysyvät muuttumattomina.'
        ]
      },
      {
        id: 'sharing',
        title: 'Jakaminen',
        intro: 'Jaettu tili antaa toiselle käyttäjälle pääsyn ilman omistuksen vaihtumista.',
        points: [
          'Tilin voi jakaa muokkaaja- tai katseluoikeudella.',
          'Jos joku tekee tapahtuman jaetulta tililtä, omistaja saa siitä ilmoituksen.',
          'Jakamisen voi poistaa milloin tahansa samasta tilinäkymästä.'
        ]
      },
      {
        id: 'statistics',
        title: 'Tilastot',
        intro: 'Vuosinäkymä auttaa vertailemaan tuloja, menoja, säästöjä ja kategorioiden jakaumaa.',
        points: [
          'Valitse vuosi ja tili, jotta näet juuri sinulle tärkeät tiedot.',
          'Kategoriataulukko näyttää kuukausiarvot sekä vuoden kokonaissumman oikealla.',
          'Kaaviot antavat nopeasti kuvan trendeistä ja muutoksista.'
        ]
      },
      {
        id: 'recurring',
        title: 'Toistuvat maksut ja ilmoitukset',
        intro: 'Toistuvat maksut auttavat pitämään säännölliset tulot ja menot ajassa.',
        points: [
          'Lisää toistuva maksu tai merkitse kategoria toistuvaksi ja määritä eräpäivä sekä summa.',
          'Muistutus voidaan maksaa tai ohittaa, ja tilanne lasketaan uudelleen tapahtumien muuttuessa.',
          'Ilmoitukset kattavat jakamisen, siirrot, toistuvat maksut ja muut tärkeät tapahtumat.'
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
