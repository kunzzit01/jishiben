package com.jishiben.api.budget;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BudgetRepository extends JpaRepository<Budget, Long> {

    List<Budget> findByOwnerIdOrderByScopeAscCategoryIdAsc(Long ownerId);

    List<Budget> findByOwnerIdAndCurrencyOrderByScopeAscCategoryIdAsc(Long ownerId, String currency);

    Optional<Budget> findByOwnerIdAndClientUid(Long ownerId, String clientUid);

    Optional<Budget> findByOwnerIdAndScopeAndCurrencyAndCategoryId(Long ownerId, String scope, String currency,
                                                                  Long categoryId);

    Optional<Budget> findByOwnerIdAndScopeAndCurrencyAndCategoryIdIsNull(Long ownerId, String scope,
                                                                        String currency);
}
