import { Component, HostListener, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { LoginModalComponent } from '../../login-modal/login-modal.component';
import { CalculatorComponent } from '../../tools/calculator/calculator.component';
import { LanguageCode, TranslationService } from '../../i18n/translation.service';
import { NotificationItem, NotificationService } from '../../notifications/notification.service';
import { TransactionDraftService } from '../../features/transactions/services/transaction-draft.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterLink, LoginModalComponent, CalculatorComponent],
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
  isCalculatorVisible = false;
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
    });
  }

  @HostListener('document:click', ['$event'])
  handleDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.tools-menu')) {
      this.isToolsOpen = false;
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
  }

  openLoginModal(): void {
    this.isToolsOpen = false;
    this.isUserMenuOpen = false;
    this.isLanguageMenuOpen = false;
    this.isNotificationsOpen = false;
    this.isLoginModalOpen = true;
  }

  closeLoginModal(): void {
    this.isLoginModalOpen = false;
  }

  toggleToolsMenu(): void {
    this.isUserMenuOpen = false;
    this.isLanguageMenuOpen = false;
    this.isNotificationsOpen = false;
    this.isToolsOpen = !this.isToolsOpen;
  }

  toggleUserMenu(): void {
    this.isToolsOpen = false;
    this.isLanguageMenuOpen = false;
    this.isNotificationsOpen = false;
    this.isUserMenuOpen = !this.isUserMenuOpen;
  }

  closeUserMenu(): void {
    this.isUserMenuOpen = false;
  }

  toggleLanguageMenu(): void {
    this.isToolsOpen = false;
    this.isUserMenuOpen = false;
    this.isNotificationsOpen = false;
    this.isLanguageMenuOpen = !this.isLanguageMenuOpen;
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
    this.isToolsOpen = false;
    this.isLanguageMenuOpen = false;
    this.isNotificationsOpen = false;
  }

  closeCalculator(): void {
    this.isCalculatorVisible = false;
  }

  toggleNotificationsMenu(): void {
    this.isToolsOpen = false;
    this.isUserMenuOpen = false;
    this.isLanguageMenuOpen = false;

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
    if (notification.action !== 'PAY' || notification.relatedCategoryId === null) {
      return;
    }

    this.isNotificationsOpen = false;
    this.transactionDraftService.requestOpen({
      categoryId: notification.relatedCategoryId
    });
    this.router.navigateByUrl('/transactions');
  }

  logout(): void {
    this.isUserMenuOpen = false;
    this.isToolsOpen = false;
    this.isLanguageMenuOpen = false;
    this.isNotificationsOpen = false;
    this.isCalculatorVisible = false;
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
}
