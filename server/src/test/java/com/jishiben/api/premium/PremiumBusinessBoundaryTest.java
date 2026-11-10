package com.jishiben.api.premium;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.jishiben.api.asset.*;
import com.jishiben.api.common.ApiException;
import com.jishiben.api.ledger.*;
import com.jishiben.api.paymentplan.*;
import com.jishiben.api.profile.ProfileService;
import com.jishiben.api.resolve.*;
import com.jishiben.api.transaction.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;
import org.junit.jupiter.api.Test;

class PremiumBusinessBoundaryTest {
    @Test void anotherLedgerRequiresMembershipWhileTheFirstLedgerIsFree() {
        var ledgers=mock(LedgerRepository.class); var gate=mock(PremiumService.class);
        var service=new LedgerService(ledgers,mock(AssetRepository.class),mock(TransactionRepository.class),mock(PaymentPlanRepository.class),gate);
        when(ledgers.save(any())).thenAnswer(i->i.getArgument(0));
        var request=new LedgerDtos.UpsertRequest("new","Ledger","book-outline",null,0,false,false);
        service.upsert(1,request);
        verify(gate,never()).requireFeature(anyLong(),anyString());
        when(ledgers.findByOwnerIdOrderBySortOrderAscIdAsc(1L)).thenReturn(List.of(new Ledger()));
        doThrow(ApiException.forbidden("PREMIUM_REQUIRED")).when(gate).requireFeature(1,"addLedger");
        assertThatThrownBy(()->service.upsert(1,request)).isInstanceOf(ApiException.class);
    }
    @Test void exchangeNotesStayEditableButFinancialChangesRequireMembership() {
        var repo=mock(TransactionRepository.class); var assets=mock(AssetRepository.class);
        var refs=mock(ReferenceResolver.class); var gate=mock(PremiumService.class);
        var service=new TransactionService(repo,assets,refs,mock(ProfileService.class),gate);
        Transaction row=new Transaction(); row.setOwnerId(1L); row.setClientUid("x"); row.setLedgerId(100L);
        row.setType("transfer"); row.setFromAssetId(10L); row.setToAssetId(11L); row.setCurrency("MYR");
        row.setAmount(new BigDecimal("100.0000")); row.setExchangeRate(new BigDecimal("3.50000000"));
        row.setConvertedAmount(new BigDecimal("350.0000")); row.setFee(BigDecimal.ZERO); row.setOccurredOn(LocalDate.of(2026,1,1));
        Asset from=new Asset(); from.setOwnerId(1L); from.setCurrency("MYR");
        Asset to=new Asset(); to.setOwnerId(1L); to.setCurrency("SGD");
        when(assets.findById(10L)).thenReturn(Optional.of(from)); when(assets.findById(11L)).thenReturn(Optional.of(to));
        when(repo.findByOwnerIdAndClientUid(1L,"x")).thenReturn(Optional.of(row)); when(repo.save(any())).thenAnswer(i->i.getArgument(0));
        when(refs.loadMaps(1L)).thenReturn(new RefMaps(Map.of(100L,"ledger"),Map.of(),Map.of(10L,"from",11L,"to")));
        var note=mock(TransactionDtos.PatchRequest.class); when(note.note()).thenReturn("Updated note");
        assertThat(service.patch(1,"x",note).note()).isEqualTo("Updated note");
        verify(gate,never()).requireFeature(anyLong(),anyString());
        var financial=mock(TransactionDtos.PatchRequest.class); when(financial.amount()).thenReturn(new BigDecimal("200"));
        doThrow(ApiException.forbidden("PREMIUM_REQUIRED")).when(gate).requireFeature(1,"exchange");
        assertThatThrownBy(()->service.patch(1,"x",financial)).isInstanceOf(ApiException.class);
    }
    @Test void existingPlansCanAdvanceAndPauseButCannotBeReenabledWithoutMembership() {
        var repo=mock(PaymentPlanRepository.class); var refs=mock(ReferenceResolver.class); var gate=mock(PremiumService.class);
        var service=new PaymentPlanService(repo,refs,gate);
        PaymentPlan row=new PaymentPlan(); row.setOwnerId(1L); row.setClientUid("plan"); row.setLedgerId(100L);
        row.setName("Rent"); row.setAmount(new BigDecimal("100")); row.setStartDate(LocalDate.of(2026,1,1));
        row.setType("expense"); row.setCycle("monthly"); row.setActive(true);
        when(repo.findByOwnerIdAndClientUid(1L,"plan")).thenReturn(Optional.of(row));
        when(repo.save(any())).thenAnswer(i->i.getArgument(0));
        when(refs.loadMaps(1L)).thenReturn(new RefMaps(Map.of(100L,"ledger"),Map.of(),Map.of()));
        var advance=new PaymentPlanDtos.PatchRequest(null,null,null,null,null,null,null,null,null,null,null,null,null,null,LocalDate.of(2026,2,1),null,null,null);
        service.patch(1,"plan",advance);
        var pause=new PaymentPlanDtos.PatchRequest(null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,false,null,null);
        assertThat(service.patch(1,"plan",pause).active()).isFalse();
        verify(gate,never()).requireFeature(anyLong(),anyString());
        var enable=new PaymentPlanDtos.PatchRequest(null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,true,null,null);
        doThrow(ApiException.forbidden("PREMIUM_REQUIRED")).when(gate).requireFeature(1,"financialPlan");
        assertThatThrownBy(()->service.patch(1,"plan",enable)).isInstanceOf(ApiException.class);
    }
}
