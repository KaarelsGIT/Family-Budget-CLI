import { CommonModule } from '@angular/common';
import { Component, inject, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { TranslationService } from '../../../i18n/translation.service';
import { AccountService } from '../services/account.service';

@Component({
  selector: 'app-add-account-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './add-account-modal.component.html',
  styleUrl: './add-account-modal.component.css'
})
export class AddAccountModalComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly accountService = inject(AccountService);
  readonly i18n = inject(TranslationService);

  readonly closed = output<void>();
  readonly created = output<void>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');

  readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    type: ['SAVINGS' as const, Validators.required]
  });

  close(): void {
    this.closed.emit();
  }

  submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.errorMessage.set('');
    this.isSubmitting.set(true);

    this.accountService.createAccount(this.form.getRawValue())
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: () => {
          this.created.emit();
          this.closed.emit();
        },
        error: (error: { error?: { message?: string } }) => {
          this.errorMessage.set(error.error?.message || this.i18n.translate('accounts.createFailed'));
        }
      });
  }
}
