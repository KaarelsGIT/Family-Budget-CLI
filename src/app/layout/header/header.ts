import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { LoginModalComponent } from '../../login-modal/login-modal.component';
import { CalculatorComponent } from '../../tools/calculator/calculator.component';
import { LanguageCode, TranslationService } from '../../i18n/translation.service';

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
  isLoginModalOpen = false;
  isToolsOpen = false;
  isUserMenuOpen = false;
  isLanguageMenuOpen = false;
  isCalculatorVisible = false;

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
  }

  openLoginModal(): void {
    this.isToolsOpen = false;
    this.isUserMenuOpen = false;
    this.isLanguageMenuOpen = false;
    this.isLoginModalOpen = true;
  }

  closeLoginModal(): void {
    this.isLoginModalOpen = false;
  }

  toggleToolsMenu(): void {
    this.isUserMenuOpen = false;
    this.isLanguageMenuOpen = false;
    this.isToolsOpen = !this.isToolsOpen;
  }

  toggleUserMenu(): void {
    this.isToolsOpen = false;
    this.isLanguageMenuOpen = false;
    this.isUserMenuOpen = !this.isUserMenuOpen;
  }

  closeUserMenu(): void {
    this.isUserMenuOpen = false;
  }

  toggleLanguageMenu(): void {
    this.isToolsOpen = false;
    this.isUserMenuOpen = false;
    this.isLanguageMenuOpen = !this.isLanguageMenuOpen;
  }

  setLanguage(language: LanguageCode): void {
    this.i18n.setLanguage(language);
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
  }

  closeCalculator(): void {
    this.isCalculatorVisible = false;
  }

  logout(): void {
    this.isUserMenuOpen = false;
    this.isToolsOpen = false;
    this.isLanguageMenuOpen = false;
    this.isCalculatorVisible = false;
    this.isLoginModalOpen = false;
    this.authService.logout();
    this.router.navigateByUrl('/', { replaceUrl: true });
  }
}
