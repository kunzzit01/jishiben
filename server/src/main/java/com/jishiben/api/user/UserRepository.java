package com.jishiben.api.user;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByEmailIgnoreCase(String email);

    boolean existsByEmailIgnoreCase(String email);

    /** Google sub 是大小写敏感的唯一标识，必须用精确匹配（不能复用邮箱的 IgnoreCase）。 */
    Optional<User> findByGoogleSub(String googleSub);

    @Query("select u.tokenVersion from User u where u.id = :id")
    Optional<Integer> findTokenVersionById(@Param("id") long id);
}
