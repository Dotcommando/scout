import { Component, Inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { AdminApiService, ADMIN_TAB } from './admin-api.service';

export interface IConfigurationDialogData {
  readonly tab: ADMIN_TAB;
}

@Component({
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  selector: 'scout-configuration-dialog',
  standalone: true,
  styleUrl: './configuration-dialog.component.scss',
  templateUrl: './configuration-dialog.component.html',
})
export class ConfigurationDialogComponent {
  public readonly error = signal('');
  public readonly saving = signal(false);
  public readonly tabs = ADMIN_TAB;
  public campaignId = '';
  public primaryId = '';
  public secondaryValue = '';

  public constructor(
    private readonly api: AdminApiService,
    private readonly dialogRef: MatDialogRef<ConfigurationDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public readonly data: IConfigurationDialogData,
  ) {}

  public async save(): Promise<void> {
    this.saving.set(true);
    this.error.set('');

    try {
      await this.api.createConfiguration(
        this.data.tab,
        this.data.tab === ADMIN_TAB.DISCOVERY
          ? this.createDiscoveryPayload()
          : this.createQualificationPayload(),
      );
      this.dialogRef.close(this.campaignId.trim());
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : 'Configuration could not be created');
      this.saving.set(false);
    }
  }

  private createDiscoveryPayload(): unknown {
    const scopes = this.secondaryValue
      .split('\n')
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0)
      .map((scope, index) => ({
        id: scope,
        label: scope,
        priority: index + 1,
      }));

    return {
      campaignId: this.campaignId.trim(),
      limits: {
        dailyProviderItemLimit: 500,
        maxProviderItemsPerRun: 100,
      },
      scopes,
      searchQueries: ['independent hotel'],
      source: {
        actorId: this.primaryId.trim(),
        kind: 'google-maps',
      },
    };
  }

  private createQualificationPayload(): unknown {
    return {
      campaignId: this.campaignId.trim(),
      catalogRevision: this.secondaryValue.trim(),
      enrichment: {
        actorDefinitionId: 'google-hotels-market',
        actorRevision: 'latest',
        amenityCatalogue: ['pool', 'spa', 'restaurant', 'bar', 'gym'],
        cachePolicyRevision: 'qualification-google-hotels-v1',
        currency: 'GBP',
        enabled: true,
        guests: 2,
        locale: 'en',
        nights: 1,
      },
      excludedSourceIdentities: [],
      excludedWebsiteHosts: [],
      knownAffiliationScopes: ['franchise', 'management', 'collection', 'soft-brand'],
      profileId: this.primaryId.trim(),
      requirements: {
        address: false,
        name: true,
        phoneNumber: false,
        websiteUrl: false,
      },
    };
  }
}
