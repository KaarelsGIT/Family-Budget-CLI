import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { LoginModalComponent } from '../../login-modal/login-modal.component';
import { CalculatorComponent } from '../../tools/calculator/calculator.component';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterLink, LoginModalComponent, CalculatorComponent],
  templateUrl: './header.html',
  styleUrl: './header.css'
})
export class Header {
  readonly authService = inject(AuthService);
  isLoginModalOpen = false;
  isToolsOpen = false;
  isUserMenuOpen = false;
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
  }

  openLoginModal(): void {
    this.isToolsOpen = false;
    this.isUserMenuOpen = false;
    this.isLoginModalOpen = true;
  }

  closeLoginModal(): void {
    this.isLoginModalOpen = false;
  }

  toggleToolsMenu(): void {
    this.isUserMenuOpen = false;
    this.isToolsOpen = !this.isToolsOpen;
  }

  toggleUserMenu(): void {
    this.isToolsOpen = false;
    this.isUserMenuOpen = !this.isUserMenuOpen;
  }

  closeUserMenu(): void {
    this.isUserMenuOpen = false;
  }

  openCalculator(): void {
    this.isCalculatorVisible = true;
    this.isToolsOpen = false;
  }

  closeCalculator(): void {
    this.isCalculatorVisible = false;
  }

  logout(): void {
    this.isUserMenuOpen = false;
    this.authService.logout();
  }
}
