import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { TranslationService } from '../../../../core/services/i18n/translation.service';
import { Account } from '../../models/account.model';
import { AccountService } from '../../services/account.service';

interface SelectableFamilySavingsAccount {
  id: number;
  name: string;
  balance: number;
  ownerUsername: string;
  type: Account['type'];
}

@Component({
  selector: 'app-family-savings-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './family-savings-modal.component.html',
  styleUrl: './family-savings-modal.component.css'
})
export class FamilySavingsModalComponent implements OnInit {
  private readonly accountService = inject(AccountService);
  readonly i18n = inject(TranslationService);

  readonly accounts = input<SelectableFamilySavingsAccount[]>([]);
  readonly selectedAccountIds = input<number[]>([]);
  readonly closed = output<void>();
  readonly saved = output<number[]>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');
  readonly pendingSelection = signal<number[]>([]);

  ngOnInit(): void {
    this.pendingSelection.set(this.selectedAccountIds());
  }

  close(): void {
    this.closed.emit();
  }

  isSelected(accountId: number): boolean {
    return this.pendingSelection().includes(accountId);
  }

  toggle(accountId: number, checked: boolean): void {
    const next = checked
      ? Array.from(new Set([...this.pendingSelection(), accountId]))
      : this.pendingSelection().filter((id) => id !== accountId);
    this.pendingSelection.set(next);
  }

  save(): void {
    if (this.isSubmitting()) {
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set('');

    this.accountService.updateFamilySavingsSelection(this.pendingSelection())
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: (selection) => {
          this.saved.emit(selection);
          this.closed.emit();
        },
        error: (error: { error?: { message?: string } }) => {
          this.errorMessage.set(error.error?.message || 'Salvestamine ebaõnnestus.');
        }
      });
  }
}
