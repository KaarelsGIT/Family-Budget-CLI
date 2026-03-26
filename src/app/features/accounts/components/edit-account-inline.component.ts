import { CommonModule } from '@angular/common';
import { Component, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { TranslationService } from '../../../i18n/translation.service';
import { Account } from '../models/account.model';
import { AccountService } from '../services/account.service';

@Component({
  selector: 'app-edit-account-inline',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './edit-account-inline.component.html',
  styleUrl: './edit-account-inline.component.css'
})
export class EditAccountInlineComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly accountService = inject(AccountService);
  readonly i18n = inject(TranslationService);

  readonly account = input.required<Account>();
  readonly editable = input(true);
  readonly showTrigger = input(true);
  readonly updated = output<Account>();

  readonly isEditing = signal(false);
  readonly isSaving = signal(false);
  readonly errorMessage = signal('');

  readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]]
  });

  startEditing(): void {
    if (!this.editable()) {
      return;
    }

    this.errorMessage.set('');
    this.form.reset({
      name: this.account().name
    });
    this.isEditing.set(true);
  }

  cancel(): void {
    this.isEditing.set(false);
    this.errorMessage.set('');
    this.form.reset({
      name: this.account().name
    });
  }

  save(): void {
    if (this.form.invalid || this.isSaving()) {
      this.form.markAllAsTouched();
      return;
    }

    this.errorMessage.set('');
    this.isSaving.set(true);

    this.accountService.updateAccount(this.account().id, this.form.getRawValue())
      .pipe(finalize(() => this.isSaving.set(false)))
      .subscribe({
        next: (account) => {
          this.isEditing.set(false);
          this.updated.emit(account);
        },
        error: (error: { error?: { message?: string } }) => {
          this.errorMessage.set(error.error?.message || this.i18n.translate('accounts.renameFailed'));
        }
      });
  }
}
