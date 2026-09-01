export interface IProviderQuotaRepositoryPort {
  reserveDailyQuota(
    input: IReserveDailyQuotaInput,
  ): Promise<IProviderQuotaReservation | null>;
}

export interface IProviderQuotaReservation {
  readonly campaignId: string;
  readonly quotaDay: string;
  readonly reservedItemCount: number;
}

export interface IReserveDailyQuotaInput {
  readonly campaignId: string;
  readonly dailyItemLimit: number;
  readonly quotaDay: string;
  readonly requestedItemCount: number;
}
