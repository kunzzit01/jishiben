package com.jishiben.api.paymentplan;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PaymentPlanRepository extends JpaRepository<PaymentPlan, Long> {

    List<PaymentPlan> findByOwnerIdOrderBySortOrderAscIdAsc(Long ownerId);

    List<PaymentPlan> findByOwnerIdAndLedgerId(Long ownerId, Long ledgerId);

    Optional<PaymentPlan> findByOwnerIdAndClientUid(Long ownerId, String clientUid);

    long countByOwnerIdAndLedgerId(Long ownerId, Long ledgerId);

    @Modifying
    @Query("delete from PaymentPlan p where p.ownerId = :ownerId and p.ledgerId = :ledgerId")
    int deleteAllByLedger(@Param("ownerId") long ownerId, @Param("ledgerId") Long ledgerId);
}
