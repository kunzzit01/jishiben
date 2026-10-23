package com.jishiben.api.ledger;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LedgerRepository extends JpaRepository<Ledger, Long> {

    List<Ledger> findByOwnerIdOrderBySortOrderAscIdAsc(Long ownerId);

    List<Ledger> findByOwnerIdAndArchivedAtIsNullOrderBySortOrderAscIdAsc(Long ownerId);

    Optional<Ledger> findByOwnerIdAndClientUid(Long ownerId, String clientUid);

    boolean existsByOwnerIdAndDefaultLedgerTrue(Long ownerId);
}
