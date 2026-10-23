package com.jishiben.api.asset;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AssetRepository extends JpaRepository<Asset, Long> {

    List<Asset> findByOwnerIdOrderBySortOrderAscIdAsc(Long ownerId);

    List<Asset> findByOwnerIdAndArchivedAtIsNullOrderBySortOrderAscIdAsc(Long ownerId);

    List<Asset> findByOwnerIdAndLedgerIdOrderBySortOrderAscIdAsc(Long ownerId, Long ledgerId);

    List<Asset> findByOwnerIdAndLedgerId(Long ownerId, Long ledgerId);

    Optional<Asset> findByOwnerIdAndClientUid(Long ownerId, String clientUid);

    long countByOwnerIdAndLedgerId(Long ownerId, Long ledgerId);

    @Modifying
    @Query("delete from Asset a where a.ownerId = :ownerId and a.ledgerId = :ledgerId")
    int deleteAllByLedger(@Param("ownerId") long ownerId, @Param("ledgerId") Long ledgerId);

    @Modifying
    @Query("update Asset a set a.defaultAsset = false where a.ownerId = :ownerId and a.defaultAsset = true")
    int clearDefaults(@Param("ownerId") long ownerId);
}
