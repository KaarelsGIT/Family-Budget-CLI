import { Component, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslationService } from '../../../../i18n/translation.service';
import { Account } from '../../models/account.model';
import { TransferFormComponent, TransferSubmittedEvent } from '../transfer-form/transfer-form.component';

@Component({
  selector: 'app-transfer-modal',
  standalone: true,
  imports: [CommonModule, TransferFormComponent],
  templateUrl: './transfer-modal.component.html',
  styleUrl: './transfer-modal.component.css'
})
export class TransferModalComponent {
  readonly i18n = inject(TranslationService);
  readonly sourceAccount = input.required<Account>();
  readonly accounts = input.required<Account[]>();
  readonly closed = output<void>();
  readonly transferred = output<TransferSubmittedEvent>();
  readonly error = output<string>();

  close(): void {
    this.closed.emit();
  }

  onTransferred(event: TransferSubmittedEvent): void {
    this.transferred.emit(event);
    this.closed.emit();
  }

  onError(message: string): void {
    this.error.emit(message);
  }
}
