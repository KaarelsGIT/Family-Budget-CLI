import { Component, HostListener, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { LoginModalComponent } from '../../login-modal/login-modal.component';
import { CalculatorComponent } from '../../tools/calculator/calculator.component';
import { SalaryCalculatorModal } from '../../tools/salary-calculator-modal/salary-calculator-modal';
import { LanguageCode, TranslationService } from '../../i18n/translation.service';
import { NotificationItem, NotificationService } from '../../notifications/notification.service';
import { RecurringRemindersModalComponent } from '../../notifications/components/recurring-reminders-modal/recurring-reminders-modal.component';
import { TransactionDraftService } from '../../features/transactions/services/transaction-draft.service';
import { HelpGuideModalComponent } from '../../help/components/help-guide-modal/help-guide-modal.component';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterLink, LoginModalComponent, CalculatorComponent, SalaryCalculatorModal, RecurringRemindersModalComponent, HelpGuideModalComponent],
  templateUrl: './header.html',
  styleUrl: './header.css'
})
export class Header {
  readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);
  private readonly router = inject(Router);
  private readonly notificationService = inject(NotificationService);
  private readonly transactionDraftService = inject(TransactionDraftService);
  isLoginModalOpen = false;
  isToolsOpen = false;
  isUserMenuOpen = false;
  isLanguageMenuOpen = false;
  isNotificationsOpen = false;
  isTransactionsOpen = false;
  isCalculatorVisible = false;
  isSalaryCalculatorVisible = false;
  isRecurringRemindersModalOpen = false;
  isHelpOpen = false;
  highlightedReminderId: number | null = null;
  isLoadingNotifications = false;
  unreadNotificationsCount = 0;
  notifications: NotificationItem[] = [];

  constructor() {
    effect(() => {
      if (this.authService.isLoggedIn()) {
        this.isLoginModalOpen = false;
        this.loadUnreadCount();
        return;
      }

      this.unreadNotificationsCount = 0;
      this.notifications = [];
      this.isNotificationsOpen = false;
      this.isHelpOpen = false;
    });
  }

  @HostListener('document:click', ['$event'])
  handleDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.tools-menu')) {
      this.isToolsOpen = false;
    }
    if (!target?.closest('.transactions-menu')) {
      this.isTransactionsOpen = false;
    }
    if (!target?.closest('.user-menu')) {
      this.isUserMenuOpen = false;
    }
    if (!target?.closest('.language-menu')) {
      this.isLanguageMenuOpen = false;
    }
    if (!target?.closest('.notifications-menu')) {
      this.isNotificationsOpen = false;
    }
    if (!target?.closest('.help-open-trigger') && !target?.closest('.help-guide-modal')) {
      this.isHelpOpen = false;
    }
  }

  openLoginModal(): void {
    this.isToolsOpen = false;
    this.isUserMenuOpen = false;
    this.isLanguageMenuOpen = false;
    this.isNotificationsOpen = false;
    this.isHelpOpen = false;
    this.isLoginModalOpen = true;
  }

  closeLoginModal(): void {
    this.isLoginModalOpen = false;
  }

  toggleToolsMenu(): void {
    this.isUserMenuOpen = false;
    this.isLanguageMenuOpen = false;
    this.isNotificationsOpen = false;
    this.isHelpOpen = false;
    this.isToolsOpen = !this.isToolsOpen;
  }

  toggleUserMenu(): void {
    this.isToolsOpen = false;
    this.isLanguageMenuOpen = false;
    this.isNotificationsOpen = false;
    this.isHelpOpen = false;
    this.isUserMenuOpen = !this.isUserMenuOpen;
  }

  closeUserMenu(): void {
    this.isUserMenuOpen = false;
  }

  toggleLanguageMenu(): void {
    this.isToolsOpen = false;
    this.isUserMenuOpen = false;
    this.isNotificationsOpen = false;
    this.isHelpOpen = false;
    this.isLanguageMenuOpen = !this.isLanguageMenuOpen;
  }

  closeHelpGuide(): void {
    this.isHelpOpen = false;
  }

  openHelpGuide(): void {
    this.isToolsOpen = false;
    this.isLanguageMenuOpen = false;
    this.isNotificationsOpen = false;
    this.isUserMenuOpen = false;
    this.isHelpOpen = true;
  }

  setLanguage(language: LanguageCode): void {
    this.i18n.setLanguage(language);
    if (this.authService.isLoggedIn()) {
      this.authService.updatePreferredLanguage(language).subscribe({
        error: () => {
          // Keep UI language even if the backend update fails.
        }
      });
    }
    this.isLanguageMenuOpen = false;
  }

  getSelectedLanguage() {
    const currentLanguage = this.i18n.language();
    return this.i18n.supportedLanguages.find(({ code }) => code === currentLanguage) ?? this.i18n.supportedLanguages[0];
  }

  openCalculator(): void {
    this.isCalculatorVisible = true;
    this.isSalaryCalculatorVisible = false;
    this.isToolsOpen = false;
    this.isLanguageMenuOpen = false;
    this.isNotificationsOpen = false;
    this.isHelpOpen = false;
  }

  openSalaryCalculator(): void {
    this.isSalaryCalculatorVisible = true;
    this.isCalculatorVisible = false;
    this.isToolsOpen = false;
    this.isLanguageMenuOpen = false;
    this.isNotificationsOpen = false;
    this.isHelpOpen = false;
  }

  toggleTransactionsMenu(): void {
    this.isToolsOpen = false;
    this.isUserMenuOpen = false;
    this.isLanguageMenuOpen = false;
    this.isNotificationsOpen = false;
    this.isHelpOpen = false;
    this.isTransactionsOpen = !this.isTransactionsOpen;
  }

  closeTransactionsMenu(): void {
    this.isTransactionsOpen = false;
  }

  openAddTransaction(): void {
    this.transactionDraftService.requestOpen({ type: 'EXPENSE' });
    this.closeTransactionsMenu();
    this.isUserMenuOpen = false;
    this.isToolsOpen = false;
    this.isLanguageMenuOpen = false;
    this.isNotificationsOpen = false;
    this.isHelpOpen = false;
  }

  closeCalculator(): void {
    this.isCalculatorVisible = false;
  }

  closeSalaryCalculator(): void {
    this.isSalaryCalculatorVisible = false;
  }

  toggleNotificationsMenu(): void {
    this.isToolsOpen = false;
    this.isUserMenuOpen = false;
    this.isLanguageMenuOpen = false;
    this.isHelpOpen = false;

    const nextState = !this.isNotificationsOpen;
    this.isNotificationsOpen = nextState;

    if (!nextState || !this.authService.isLoggedIn()) {
      return;
    }

    this.loadNotifications();
  }

  formatNotificationDate(value: string): string {
    return new Intl.DateTimeFormat(this.i18n.language(), {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  }

  handleNotificationAction(notification: NotificationItem): void {
    if (notification.action !== 'PAY') {
      return;
    }

    this.isNotificationsOpen = false;

    if (notification.type === 'RECURRING_PAYMENT_DUE' && notification.relatedReminderId !== null) {
      this.openRecurringRemindersModal(notification.relatedReminderId);
      return;
    }

    this.openCategoryPayment(notification);
  }

  clearNotifications(): void {
    if (this.isLoadingNotifications) {
      return;
    }

    this.isLoadingNotifications = true;
    this.notificationService.deleteAll()
      .pipe(finalize(() => {
        this.isLoadingNotifications = false;
      }))
      .subscribe({
        next: () => {
          this.notifications = [];
          this.unreadNotificationsCount = 0;
        },
        error: () => {
          this.loadNotifications();
        }
      });
  }

  logout(): void {
    this.isUserMenuOpen = false;
    this.isToolsOpen = false;
    this.isLanguageMenuOpen = false;
    this.isNotificationsOpen = false;
    this.isHelpOpen = false;
    this.isCalculatorVisible = false;
    this.isSalaryCalculatorVisible = false;
    this.isLoginModalOpen = false;
    this.unreadNotificationsCount = 0;
    this.notifications = [];
    this.authService.logout();
    this.router.navigateByUrl('/', { replaceUrl: true });
  }

  private loadUnreadCount(): void {
    this.notificationService.getUnreadCount().subscribe({
      next: (count) => {
        this.unreadNotificationsCount = count;
      },
      error: () => {
        this.unreadNotificationsCount = 0;
      }
    });
  }

  private loadNotifications(): void {
    if (this.isLoadingNotifications) {
      return;
    }

    this.isLoadingNotifications = true;

    this.notificationService.getNotifications()
      .pipe(finalize(() => {
        this.isLoadingNotifications = false;
      }))
      .subscribe({
        next: (notifications) => {
          this.notifications = notifications;
          if (this.unreadNotificationsCount > 0) {
            this.notificationService.markAllAsRead().subscribe();
            this.notifications = this.notifications.map((notification) => ({
              ...notification,
              isRead: true
            }));
            this.unreadNotificationsCount = 0;
          }
        },
        error: () => {
          this.notifications = [];
        }
      });
  }

  private openCategoryPayment(notification: NotificationItem): void {
    if (notification.relatedCategoryId === null) {
      return;
    }

    this.transactionDraftService.requestOpen({
      categoryId: notification.relatedCategoryId
    });
  }

  openRecurringRemindersModal(selectedReminderId: number | null = null): void {
    this.highlightedReminderId = selectedReminderId;
    this.isRecurringRemindersModalOpen = true;
  }

  closeRecurringRemindersModal(): void {
    this.isRecurringRemindersModalOpen = false;
    this.highlightedReminderId = null;
  }
}
